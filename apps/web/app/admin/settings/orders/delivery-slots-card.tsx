"use client";

// Delivery Slots card — Settings > Orders (doc 18, F2-1).
// List editor over the `orders.delivery_slots` Settings value (a JSON
// array of { id, labelBn, labelEn } — src/checkout/delivery-slots.ts),
// which checkout and the manual builder offer as delivery time bands.
// Until now it was writable only through the generic Settings API.
// Saves go through that same API (POST /api/v1/admin/settings
// { key, value, reason }) — audited, reason required.
//
// ID LOCKING: a slot's id is persisted on every order that chose it
// (Order.deliverySlot) and labels are resolved from the CURRENT
// setting at display time. Renaming an id would orphan those orders —
// their slot would render as a raw id. So ids of rows that were part
// of the saved configuration are LOCKED here; only a row added in
// this editing session has an editable id (until it is saved).
// Removing a slot carries the same warning, shown inline on save.
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import type { DeliverySlot } from "@/checkout/delivery-slots";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";
import { serializeSlotRows, validateSlotRows, type SlotRow } from "./orders-settings-shared";

const SLOTS_SETTING_KEY = "orders.delivery_slots";

interface EditorRow extends SlotRow {
  /** Added in this session — the only rows whose id may be edited. */
  isNew: boolean;
}

interface DeliverySlotsCardProps {
  /** Effective slots right now (loader output: stored set or defaults). */
  initialSlots: DeliverySlot[];
  /** True when a stored value exists and differs from the built-in
   *  default set (i.e. someone has customized the slots before). */
  storedCustomized: boolean;
  dbReady: boolean;
}

export function DeliverySlotsCard({ initialSlots, storedCustomized, dbReady }: DeliverySlotsCardProps) {
  const { locale, t: common } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialSlots.map((s) => ({ id: s.id, labelBn: s.labelBn, labelEn: s.labelEn, isNew: false })),
  );
  const [removedSavedIds, setRemovedSavedIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const initialSerialized = useMemo(() => serializeSlotRows(initialSlots), [initialSlots]);
  const validation = useMemo(() => validateSlotRows(rows, locale), [rows, locale]);
  const changed = "value" in validation && validation.value !== initialSerialized;

  function updateRow(index: number, patch: Partial<EditorRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => {
      const row = prev[index];
      if (row && !row.isNew) {
        setRemovedSavedIds((ids) => (ids.includes(row.id) ? ids : [...ids, row.id]));
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  function addRow() {
    setRows((prev) => [...prev, { id: "", labelBn: "", labelEn: "", isNew: true }]);
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
      setStatus(s.slotNoChange);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: SLOTS_SETTING_KEY, value: validation.value, reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setStatusOk(false);
        setStatus(data.error?.message ?? interpolate(s.saveFailedDot, { status: res.status }));
        return;
      }
      // What was just saved is now the locked configuration.
      setRows((prev) => prev.map((r) => ({ ...r, isNew: false })));
      setRemovedSavedIds([]);
      setStatusOk(true);
      setStatus(interpolate(s.slotSaved, { count: rows.length }));
    } catch {
      setStatusOk(false);
      setStatus(s.networkNothingSaved);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="clock" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.slotTitle}</h2>
        </div>

        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3.5 text-sm">
          <p className="leading-relaxed">
            {s.slotSummaryA}<strong>{interpolate(s.slotSummaryCount, { count: initialSlots.length })}</strong>
            {storedCustomized ? s.slotCustom : s.slotDefault}
            {s.slotSummaryB}<strong>{s.slotIdWord}</strong>{s.slotSummaryC}
          </p>
          {!dbReady && (
            <span className="mt-1.5 block leading-relaxed text-rose-600">
              {s.dbWarningShort}
            </span>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="rounded-lg border border-border/70 p-3.5">
              <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_1.4fr_auto]">
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.slotIdLabel}</span>
                  <input
                    type="text"
                    value={row.id}
                    disabled={!row.isNew || saving}
                    onChange={(e) => updateRow(index, { id: e.target.value })}
                    placeholder={s.slotIdPlaceholder}
                    className="mt-1 block min-h-[40px] w-full rounded-lg border border-border bg-card px-3 font-mono text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100 disabled:bg-surface-2 disabled:text-text-muted"
                  />
                  {!row.isNew && (
                    <span className="mt-1 block text-[11px] leading-relaxed text-text-muted">
                      {s.slotIdLocked}
                    </span>
                  )}
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.slotLabelBn}</span>
                  <input
                    type="text"
                    value={row.labelBn}
                    disabled={saving}
                    onChange={(e) => updateRow(index, { labelBn: e.target.value })}
                    placeholder={s.slotLabelBnPlaceholder}
                    className="mt-1 block min-h-[40px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-text-muted">{s.slotLabelEn}</span>
                  <input
                    type="text"
                    value={row.labelEn}
                    disabled={saving}
                    onChange={(e) => updateRow(index, { labelEn: e.target.value })}
                    placeholder={s.slotLabelEnPlaceholder}
                    className="mt-1 block min-h-[40px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
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
        </div>

        {removedSavedIds.length > 0 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <span aria-hidden="true" className="mt-0.5 shrink-0">
              <Icon name="alert" size={15} />
            </span>
            <p className="leading-relaxed">
              {s.slotRemoveWarningA}<strong>{removedSavedIds.join(", ")}</strong>{s.slotRemoveWarningB}
            </p>
          </div>
        )}

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
            <Icon name="plus" size={15} /> {s.slotAdd}
          </button>
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonLabel}</span>
            <input
              type="text"
              placeholder={s.slotReasonPlaceholder}
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
            {saving ? common.saving : s.slotSave}
          </button>
        </div>

        <p className="mt-3 text-sm text-text-muted">
          {s.slotPreview}
          {rows.length === 0
            ? "—"
            : rows.map((r) => (locale === "bn" ? r.labelBn : r.labelEn) || r.id).join(" · ")}
        </p>

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
