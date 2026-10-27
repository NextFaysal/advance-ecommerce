"use client";

// Age-restricted categories card — Settings > Privacy (ADV-29).
// Edits the ONE JSON document behind the
// `catalog.age_restricted_categories` Setting through the standard
// Settings API (POST /api/v1/admin/settings { key, value, reason }),
// so every change is audited (settings.update) with a mandatory
// reason like every other settings write. Products in a listed
// category require a customer age ATTESTATION at checkout — a
// recorded self-declaration, NOT identity/age verification; the
// card copy says so, so no operator mistakes this for a KYC gate.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

const AGE_RESTRICTIONS_KEY = "catalog.age_restricted_categories";

interface RestrictionRow {
  slug: string;
  minAge: number;
}

interface AgeGateCardProps {
  initialRestrictions: RestrictionRow[];
  categorySlugs: string[];
  dbReady: boolean;
}

export function AgeGateCard({ initialRestrictions, categorySlugs, dbReady }: AgeGateCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [rows, setRows] = useState<RestrictionRow[]>(initialRestrictions);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateRow(index: number, patch: Partial<RestrictionRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    const cleaned: RestrictionRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const slug = row.slug.trim();
      if (slug === "") continue;
      if (seen.has(slug)) {
        setStatusOk(false);
        setStatus(interpolate(s.ageDuplicate, { slug }));
        return;
      }
      seen.add(slug);
      const minAge = Number.isFinite(row.minAge) ? Math.min(120, Math.max(1, Math.round(row.minAge))) : 18;
      cleaned.push({ slug, minAge });
    }
    const value = JSON.stringify({ restrictions: cleaned });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: AGE_RESTRICTIONS_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(interpolate(s.saveFailedWith, { message: data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status }) }));
        return;
      }
      setRows(cleaned);
      setStatusOk(true);
      setStatus(cleaned.length === 0 ? s.ageSavedNone : interpolate(s.ageSavedMany, { count: cleaned.length }));
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertain);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="shield" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.ageTitle}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {s.ageDescA}
          <strong className="text-text-main">{s.ageDescStrong}</strong>
          {s.ageDescB}
          <code className="font-mono text-xs">catalog.age_restricted_categories</code>.
          {!dbReady && <span className="mt-1.5 block text-rose-600">{s.ageDbWarning}</span>}
        </p>

        <div className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">{s.ageEmpty}</p>
          ) : (
            rows.map((row, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="min-w-52 flex-1">
                  <span className="text-sm font-medium">{s.ageSlugLabel}</span>
                  <input
                    className={inputCls}
                    value={row.slug}
                    list="age-gate-category-slugs"
                    placeholder={s.ageSlugPlaceholder}
                    onChange={(e) => updateRow(i, { slug: e.target.value })}
                    disabled={saving}
                  />
                </label>
                <label className="w-32">
                  <span className="text-sm font-medium">{s.ageMinLabel}</span>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={120}
                    value={row.minAge}
                    onChange={(e) => updateRow(i, { minAge: Number(e.target.value) })}
                    disabled={saving}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  disabled={saving}
                  className="min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  {s.ageRemove}
                </button>
              </div>
            ))
          )}
          <datalist id="age-gate-category-slugs">
            {categorySlugs.map((slug) => (
              <option key={slug} value={slug} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { slug: "", minAge: 18 }])}
            disabled={saving}
            className="min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50"
          >
            {s.ageAdd}
          </button>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium">{s.ageReasonLabel}</span>
          <input
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.ageReasonPlaceholder}
            disabled={saving}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="brand-gradient min-h-[44px] rounded-lg px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? s.saving : s.save}
          </button>
          {status !== "" && (
            <p className={`text-sm ${statusOk ? "text-emerald-600" : "text-rose-600"}`} role="status">
              {status}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
