"use client";

// Store Name card — Settings index (doc 21, G3-17). `general.store_name`
// drives the brand blocks on the order print invoice
// (app/admin/orders/print) and the public payment-link page
// (app/pay/[token]), but until now it could only be written by the
// setup wizard (src/platform/setup.ts) — Settings > General showed the
// locale/currency/timezone summary with no way to set the name, even
// though the print page tells staff to set it here. This card is that
// field: it saves through the standard Settings API
// (POST /api/v1/admin/settings { key, value, reason }), so the change
// is audited (settings.update) with a required reason, exactly like
// every other settings write. Saving the unchanged name is a no-op.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "./strings";

const STORE_NAME_KEY = "general.store_name";
const MAX_LENGTH = 120;

interface StoreNameCardProps {
  /** Effective store name right now (DB value over the built-in
   *  default "", via getPublicSettings on the server page). */
  initial: string;
  dbReady: boolean;
}

export function StoreNameCard({ initial, dbReady }: StoreNameCardProps) {
  const { locale, t } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [name, setName] = useState(initial);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setStatus("");
    const value = name.trim();
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    if (value.length > MAX_LENGTH) {
      setStatusOk(false);
      setStatus(interpolate(s.snTooLong, { max: MAX_LENGTH }));
      return;
    }
    if (value === initial.trim()) {
      setStatusOk(true);
      setStatus(s.snNoChange);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: STORE_NAME_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(interpolate(s.snSaveFailed, { key: STORE_NAME_KEY, message: data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status }) }));
        return;
      }
      setStatusOk(true);
      setStatus(value === "" ? s.snSavedCleared : interpolate(s.snSaved, { value }));
    } catch {
      setStatusOk(false);
      setStatus(s.snNetwork);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="store" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.snTitle}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {s.snDescA}<code>/pay/[token]</code>{s.snDescB}<code className="font-mono text-xs">general.store_name</code>{s.snDescC}
          {!dbReady && (
            <span className="mt-1.5 block text-rose-600">
              {s.snDbWarning}
            </span>
          )}
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block grow basis-64">
            <span className="text-sm font-medium">{s.snNameLabel}</span>
            <input
              type="text"
              placeholder={s.snNamePlaceholder}
              maxLength={MAX_LENGTH + 20}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className="mt-1 block min-h-[44px] w-full max-w-md rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
          </label>
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonLabel}</span>
            <input
              type="text"
              placeholder={s.snReasonPlaceholder}
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
            {saving ? t.saving : s.snSave}
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
