"use client";

// Order Rules card — Settings > Orders (doc 18, F2-1).
// Edits the five `orders.rules.*` Settings keys that
// src/checkout/order-rules.ts enforces at public order create:
// minimum order, the advance-required rule, and the COD blocklists
// (districts + categories). Until now they were writable only through
// the generic Settings API — no UI existed. Every save goes through
// that same API (POST /api/v1/admin/settings { key, value, reason }),
// so each change is audited (settings.update) exactly like every
// other settings write, and a reason is required.
//
// Only keys whose value actually changed are written — saving an
// untouched form is a true no-op, which is what guarantees the
// round-trip property: the loaders (which fail open to the permissive
// defaults) see exactly the same effective rules before and after.
//
// Amounts are typed in TAKA and stored as integer poisha. District
// values are the geo dataset's canonical nameEn strings (the value
// orders store and the rule matches, case-insensitively); category
// values are real category slugs from the admin categories API data
// the server page passes in.
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import { poishaToTakaText, sameStringSet, takaTextToPoisha } from "./orders-settings-shared";

const KEYS = {
  minOrder: "orders.rules.min_order_poisha",
  districts: "orders.rules.cod_disabled_districts",
  categories: "orders.rules.cod_disabled_categories",
  advanceAbove: "orders.rules.advance_required_above_poisha",
  advancePercent: "orders.rules.advance_percent",
} as const;

export interface DistrictGroup {
  divisionEn: string;
  divisionBn: string;
  districts: { nameEn: string; nameBn: string }[];
}

export interface CategoryOption {
  slug: string;
  nameBn: string;
  nameEn: string;
  isActive: boolean;
}

interface OrderRulesCardProps {
  /** Effective rules right now (the loader's parse — the same values
   *  checkout enforces). Lists are the loader's normalized entries. */
  initial: {
    minOrderPoisha: number;
    advanceRequiredAbovePoisha: number;
    advancePercent: number;
    codDisabledDistricts: string[];
    codDisabledCategories: string[];
  };
  districtGroups: DistrictGroup[];
  categories: CategoryOption[];
  dbReady: boolean;
}

export function OrderRulesCard({ initial, districtGroups, categories, dbReady }: OrderRulesCardProps) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  // Canonical district lookup: the loader returns lowercased names;
  // the geo tree carries the canonical nameEn the editor stores.
  const canonicalByLower = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of districtGroups) for (const d of g.districts) map.set(d.nameEn.toLowerCase(), d.nameEn);
    return map;
  }, [districtGroups]);

  const [selectedDistricts, setSelectedDistricts] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const name of initial.codDisabledDistricts) {
      const canonical = canonicalByLower.get(name.trim().toLowerCase());
      if (canonical) set.add(canonical);
    }
    return set;
  });
  // Stored district entries the geo tree does not know (hand-written
  // via the API, or a renamed dataset entry). They stay part of the
  // rule — removable, but never silently dropped by an untouched save.
  const [extraDistricts, setExtraDistricts] = useState<string[]>(() =>
    initial.codDisabledDistricts.filter((n) => !canonicalByLower.has(n.trim().toLowerCase())),
  );
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    () => new Set(initial.codDisabledCategories.map((s) => s.trim().toLowerCase())),
  );
  const [districtFilter, setDistrictFilter] = useState("");
  const [minTaka, setMinTaka] = useState(initial.minOrderPoisha > 0 ? poishaToTakaText(initial.minOrderPoisha) : "");
  const [aboveTaka, setAboveTaka] = useState(
    initial.advanceRequiredAbovePoisha > 0 ? poishaToTakaText(initial.advanceRequiredAbovePoisha) : "",
  );
  const [percent, setPercent] = useState(String(initial.advancePercent));
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const minParsed = minTaka.trim() === "" ? { poisha: 0 } : takaTextToPoisha(minTaka, locale);
  const aboveParsed = aboveTaka.trim() === "" ? { poisha: 0 } : takaTextToPoisha(aboveTaka, locale);
  const percentTrimmed = percent.trim();
  const percentValue =
    percentTrimmed === "" ? 20 : /^\d+$/.test(percentTrimmed) ? Number.parseInt(percentTrimmed, 10) : NaN;
  const percentValid = Number.isInteger(percentValue) && percentValue >= 1 && percentValue <= 100;

  const districtValues = useMemo(
    () => [...selectedDistricts, ...extraDistricts],
    [selectedDistricts, extraDistricts],
  );
  const categoryValues = useMemo(() => [...selectedCategories], [selectedCategories]);

  const activeCount =
    (("poisha" in minParsed && minParsed.poisha > 0) ? 1 : 0) +
    (("poisha" in aboveParsed && aboveParsed.poisha > 0) ? 1 : 0) +
    (districtValues.length > 0 ? 1 : 0) +
    (categoryValues.length > 0 ? 1 : 0);

  function toggleDistrict(nameEn: string, on: boolean) {
    setSelectedDistricts((prev) => {
      const next = new Set(prev);
      if (on) next.add(nameEn);
      else next.delete(nameEn);
      return next;
    });
  }

  function toggleCategory(slug: string, on: boolean) {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }

  async function postSetting(key: string, value: string): Promise<string | null> {
    const res = await fetch("/api/v1/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value, reason: reason.trim() }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status });
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    if (!("poisha" in minParsed)) {
      setStatusOk(false);
      setStatus(interpolate(s.ruleMinPrefix, { error: minParsed.error }));
      return;
    }
    if (!("poisha" in aboveParsed)) {
      setStatusOk(false);
      setStatus(interpolate(s.ruleAdvPrefix, { error: aboveParsed.error }));
      return;
    }
    if (!percentValid) {
      setStatusOk(false);
      setStatus(s.rulePctInvalid);
      return;
    }

    // Diff against the effective initial state — semantic comparison
    // for the lists, integer comparison for the amounts.
    const writes: { key: string; value: string }[] = [];
    if (minParsed.poisha !== initial.minOrderPoisha) {
      writes.push({ key: KEYS.minOrder, value: String(minParsed.poisha) });
    }
    if (aboveParsed.poisha !== initial.advanceRequiredAbovePoisha) {
      writes.push({ key: KEYS.advanceAbove, value: String(aboveParsed.poisha) });
    }
    if (percentValue !== initial.advancePercent) {
      writes.push({ key: KEYS.advancePercent, value: String(percentValue) });
    }
    if (!sameStringSet(districtValues, initial.codDisabledDistricts)) {
      writes.push({ key: KEYS.districts, value: districtValues.join(",") });
    }
    if (!sameStringSet(categoryValues, initial.codDisabledCategories)) {
      writes.push({ key: KEYS.categories, value: categoryValues.join(",") });
    }
    if (writes.length === 0) {
      setStatusOk(true);
      setStatus(s.ruleNoChange);
      return;
    }

    setSaving(true);
    const savedKeys: string[] = [];
    try {
      for (const w of writes) {
        const failure = await postSetting(w.key, w.value);
        if (failure !== null) {
          setStatusOk(false);
          setStatus(
            savedKeys.length > 0
              ? interpolate(s.rulePartialFail, { key: w.key, failure, count: savedKeys.length, keys: savedKeys.join(", ") })
              : interpolate(s.ruleFail, { key: w.key, failure }),
          );
          return;
        }
        savedKeys.push(w.key);
      }
      setStatusOk(true);
      setStatus(interpolate(s.ruleSaved, { count: savedKeys.length, keys: savedKeys.join(", ") }));
    } catch {
      setStatusOk(false);
      setStatus(s.ruleNetwork);
    } finally {
      setSaving(false);
    }
  }

  const filter = districtFilter.trim().toLowerCase();

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="cart" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.ruleTitle}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            {s.ruleSummaryA}<strong>{interpolate(s.ruleSummaryActive, { count: activeCount })}</strong>{s.ruleSummaryMin}
            {"poisha" in minParsed && minParsed.poisha > 0 ? `৳${poishaToTakaText(minParsed.poisha)}` : s.stOff}
            {s.ruleSummaryAdv}
            {"poisha" in aboveParsed && aboveParsed.poisha > 0
              ? interpolate(s.ruleSummaryAdvText, { amount: poishaToTakaText(aboveParsed.poisha), pct: percentValid ? percentValue : initial.advancePercent })
              : s.stOff}
            {interpolate(s.ruleSummaryCod, { districts: districtValues.length, categories: categoryValues.length })}
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              {s.dbWarningShort}
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">{s.ruleMinLabel}</span>
            <span className="mt-1 flex items-center gap-1.5">
              <span className="text-sm text-text-muted">৳</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={s.ruleEmptyOff}
                value={minTaka}
                onChange={(e) => setMinTaka(e.target.value)}
                disabled={saving}
                className="min-h-[44px] w-44 rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
              />
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-text-muted">
              {s.ruleMinHint}
            </span>
            {"error" in minParsed && <span className="mt-1 block text-xs text-rose-600">{minParsed.error}</span>}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">{s.ruleAdvLimitLabel}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <span className="text-sm text-text-muted">৳</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={s.ruleEmptyOff}
                  value={aboveTaka}
                  onChange={(e) => setAboveTaka(e.target.value)}
                  disabled={saving}
                  className="min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                />
              </span>
              {"error" in aboveParsed && <span className="mt-1 block text-xs text-rose-600">{aboveParsed.error}</span>}
            </label>
            <label className="block">
              <span className="text-sm font-medium">{s.ruleAdvPctLabel}</span>
              <span className="mt-1 flex items-center gap-1.5">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="20"
                  value={percent}
                  onChange={(e) => setPercent(e.target.value)}
                  disabled={saving}
                  className="min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                />
                <span className="text-sm text-text-muted">%</span>
              </span>
              {!percentValid && percentTrimmed !== "" && (
                <span className="mt-1 block text-xs text-rose-600">{s.ruleAdvPctError}</span>
              )}
            </label>
            <p className="col-span-2 text-xs leading-relaxed text-text-muted">
              {s.ruleAdvHint}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <fieldset>
            <legend className="text-sm font-medium">{s.ruleDistrictsLegend}</legend>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {s.ruleDistrictsHint}
            </p>
            {extraDistricts.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {extraDistricts.map((name) => (
                  <span key={name} className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 font-mono text-xs text-amber-800 ring-1 ring-inset ring-amber-200">
                    {name} {s.ruleExtraSuffix}
                    <button
                      type="button"
                      aria-label={interpolate(s.ruleRemoveAria, { name })}
                      disabled={saving}
                      onClick={() => setExtraDistricts((prev) => prev.filter((n) => n !== name))}
                      className="text-amber-700 hover:text-amber-900"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              type="text"
              placeholder={s.ruleDistrictSearch}
              value={districtFilter}
              onChange={(e) => setDistrictFilter(e.target.value)}
              className="mt-2 min-h-[40px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border/70 p-3">
              {districtGroups.map((group) => {
                const visible = group.districts.filter(
                  (d) => filter === "" || d.nameEn.toLowerCase().includes(filter) || d.nameBn.includes(districtFilter.trim()),
                );
                if (visible.length === 0) return null;
                return (
                  <div key={group.divisionEn} className="mb-3 last:mb-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      {locale === "bn" ? group.divisionBn : group.divisionEn} · {locale === "bn" ? group.divisionEn : group.divisionBn}
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      {visible.map((d) => (
                        <label key={d.nameEn} className="flex min-h-[28px] cursor-pointer items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selectedDistricts.has(d.nameEn)}
                            disabled={saving}
                            onChange={(e) => toggleDistrict(d.nameEn, e.target.checked)}
                            className="h-4 w-4 shrink-0 accent-brand-600"
                          />
                          <span>
                            {locale === "bn" ? d.nameBn : d.nameEn} <span className="text-xs text-text-muted">({locale === "bn" ? d.nameEn : d.nameBn})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
              {filter !== "" &&
                districtGroups.every((g) =>
                  g.districts.every(
                    (d) => !d.nameEn.toLowerCase().includes(filter) && !d.nameBn.includes(districtFilter.trim()),
                  ),
                ) && <p className="text-sm text-text-muted">{s.ruleNoDistrict}</p>}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">{interpolate(s.ruleSelectedDistricts, { count: districtValues.length })}</p>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-medium">{s.ruleCategoriesLegend}</legend>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              {s.ruleCategoriesHint}
            </p>
            <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-border/70 p-3">
              {categories.length === 0 && <p className="text-sm text-text-muted">{s.ruleNoCategories}</p>}
              <div className="grid gap-y-1.5">
                {categories.map((c) => (
                  <label key={c.slug} className="flex min-h-[28px] cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(c.slug)}
                      disabled={saving}
                      onChange={(e) => toggleCategory(c.slug, e.target.checked)}
                      className="h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span>
                      {locale === "bn" ? c.nameBn : c.nameEn} <span className="text-xs text-text-muted">({locale === "bn" ? c.nameEn : c.nameBn})</span>
                    </span>
                    <code className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted">{c.slug}</code>
                    {!c.isActive && <span className="text-xs text-amber-600">{s.ruleInactive}</span>}
                  </label>
                ))}
              </div>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">{interpolate(s.ruleSelectedCategories, { count: categoryValues.length })}</p>
          </fieldset>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonLabel}</span>
            <input
              type="text"
              placeholder={s.ruleReasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? common.saving : s.ruleSave}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`anim-pop-in mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={16} />
            </span>
            <p className="leading-relaxed">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
