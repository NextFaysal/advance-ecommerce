"use client";

// Pickup points / store locations card — Settings > Orders (ADV-19).
// List editor over a Settings JSON document (stores.pickup_points or
// stores.retail_locations — src/checkout/pickup-points.ts), mounted
// once per document by the settings page. Saves go through the
// generic Settings API (POST /api/v1/admin/settings { key, value,
// reason }) — audited, reason required.
//
// ID LOCKING (same rule as delivery slots): a pickup point's id is
// recorded on orders that chose it (inside the create-time note's
// [pickup:<id>] marker), so ids of saved rows are locked here; only a
// row added in this session has an editable id. The note also freezes
// the point's name/address at order time, so renaming a point never
// rewrites history — the lock only protects the id lookup.
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import type { PickupPoint } from "@/checkout/pickup-points";

interface EditorRow extends PickupPoint {
  isNew: boolean;
}

interface PickupPointsCardProps {
  settingKey: "stores.pickup_points" | "stores.retail_locations";
  title: string;
  description: string;
  initialPoints: PickupPoint[];
  /** True when a stored document exists (even an empty list). */
  storedConfigured: boolean;
  dbReady: boolean;
}

const ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

function validateRows(rows: EditorRow[], locale: Locale): { value: string } | { error: string } {
  const s = pick(locale, SETTINGS_STRINGS);
  const seen = new Set<string>();
  for (const row of rows) {
    if (!ID_PATTERN.test(row.id.trim())) {
      return { error: interpolate(s.pickIdError, { id: row.id }) };
    }
    if (seen.has(row.id.trim())) return { error: interpolate(s.pickIdDup, { id: row.id }) };
    seen.add(row.id.trim());
    if (row.name.trim() === "") return { error: interpolate(s.pickNameEmpty, { id: row.id }) };
    if (row.address.trim() === "") return { error: interpolate(s.pickAddressEmpty, { id: row.id }) };
  }
  const value = JSON.stringify(
    rows.map((r) => ({ id: r.id.trim(), name: r.name.trim(), address: r.address.trim(), hours: r.hours.trim() })),
  );
  return { value };
}

export function PickupPointsCard({ settingKey, title, description, initialPoints, storedConfigured, dbReady }: PickupPointsCardProps) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialPoints.map((p) => ({ ...p, isNew: false })),
  );
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialSerialized = useMemo(
    () => JSON.stringify(initialPoints.map((p) => ({ id: p.id, name: p.name, address: p.address, hours: p.hours }))),
    [initialPoints],
  );
  const validation = useMemo(() => validateRows(rows, locale), [rows, locale]);
  const changed = "value" in validation && validation.value !== initialSerialized;

  function updateRow(index: number, patch: Partial<EditorRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  function addRow() {
    setRows((prev) => [...prev, { id: "", name: "", address: "", hours: "", isNew: true }]);
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    if (!("value" in validation)) {
      setStatusOk(false);
      setStatus(validation.error);
      return;
    }
    if (!changed) {
      setStatusOk(true);
      setStatus(s.pickNoChange);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: settingKey, value: validation.value, reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setStatusOk(false);
        setStatus(data.error?.message ?? interpolate(s.saveFailedDot, { status: res.status }));
        return;
      }
      setRows((prev) => prev.map((r) => ({ ...r, isNew: false })));
      setStatusOk(true);
      setStatus(interpolate(s.pickSaved, { count: rows.length }));
    } catch {
      setStatusOk(false);
      setStatus(s.networkNothingSaved);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 block min-h-[40px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 disabled:bg-surface-2 disabled:text-text-muted";

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="store" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{title}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            {s.currentlyEffective} <strong>{interpolate(s.pickSummaryCount, { count: initialPoints.length })}</strong>
            {storedConfigured ? s.pickConfigured : s.pickNotConfigured}
            {" "}{description}
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              {s.dbWarningPickup}
            </span>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="rounded-lg border border-border/70 p-3.5">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.idLabel}</span>
                  <input
                    type="text"
                    value={row.id}
                    disabled={!row.isNew || saving}
                    onChange={(e) => updateRow(index, { id: e.target.value })}
                    placeholder={s.pickIdPlaceholder}
                    className={`${inputClass} font-mono`}
                  />
                  {!row.isNew && (
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">
                      {s.idLockedNote}
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.pickNameLabel}</span>
                  <input
                    type="text"
                    value={row.name}
                    disabled={saving}
                    onChange={(e) => updateRow(index, { name: e.target.value })}
                    placeholder={s.pickNamePlaceholder}
                    className={inputClass}
                  />
                </label>
                <label className="block md:col-span-2">
                  <span className="text-xs font-medium text-text-muted">{s.pickAddressLabel}</span>
                  <input
                    type="text"
                    value={row.address}
                    disabled={saving}
                    onChange={(e) => updateRow(index, { address: e.target.value })}
                    placeholder={s.pickAddressPlaceholder}
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.pickHoursLabel}</span>
                  <input
                    type="text"
                    value={row.hours}
                    disabled={saving}
                    onChange={(e) => updateRow(index, { hours: e.target.value })}
                    placeholder={s.pickHoursPlaceholder}
                    className={inputClass}
                  />
                </label>
                <div className="flex items-end pb-0.5">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => removeRow(index)}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-rose-700 transition motion-fast hover:border-rose-300 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Icon name="x" size={14} /> {s.remove}
                  </button>
                </div>
              </div>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="text-sm text-text-muted">{s.pickEmpty}</p>
          )}
        </div>

        {"error" in validation && rows.length > 0 && (
          <p className="mt-3 text-sm text-rose-600">{validation.error}</p>
        )}

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button
            type="button"
            onClick={addRow}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300 disabled:opacity-50"
          >
            <Icon name="plus" size={15} /> {s.pickAdd}
          </button>
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonLabel}</span>
            <input
              type="text"
              placeholder={s.pickReasonPlaceholder}
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
            {saving ? common.saving : s.pickSave}
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
