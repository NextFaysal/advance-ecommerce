"use client";

// Maintenance-mode card — Settings > Privacy (ADV-29). Saves the
// ONE JSON document behind the `site.maintenance` Setting through
// the standard Settings API (POST /api/v1/admin/settings { key,
// value, reason }), so the change is audited (settings.update) with
// a mandatory reason like every other settings write. The
// storefront gate picks the change up within ~20s (middleware probe
// TTL) — the success copy says so instead of implying instant
// effect. Enabling with an empty message is refused client-side
// (the server parser would fall back to the default text anyway,
// but the operator should see and own the exact words visitors
// will read).
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

const MAINTENANCE_KEY = "site.maintenance";

interface MaintenanceCardProps {
  initialEnabled: boolean;
  initialMessageBn: string;
  initialMessageEn: string;
  dbReady: boolean;
}

export function MaintenanceCard({
  initialEnabled,
  initialMessageBn,
  initialMessageEn,
  dbReady,
}: MaintenanceCardProps) {
  const { locale } = useLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [messageBn, setMessageBn] = useState(initialMessageBn);
  const [messageEn, setMessageEn] = useState(initialMessageEn);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    if (enabled && (messageBn.trim() === "" || messageEn.trim() === "")) {
      setStatusOk(false);
      setStatus(s.maintErrBoth);
      return;
    }
    const value = JSON.stringify({
      enabled,
      message_bn: messageBn.trim(),
      message_en: messageEn.trim(),
    });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: MAINTENANCE_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(interpolate(s.saveFailedWith, { message: data.error?.message ?? interpolate(s.saveFailedStatus, { status: res.status }) }));
        return;
      }
      setStatusOk(true);
      setStatus(enabled ? s.maintSavedOn : s.maintSavedOff);
    } catch {
      setStatusOk(false);
      setStatus(s.networkUncertain);
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "mt-1 block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="bg-brand-600 h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="bg-brand-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-ink shadow-md">
            <Icon name="alert" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">{s.maintTitle}</h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          {s.maintDescA}
          <code className="font-mono text-xs">?preview=1</code>
          {s.maintDescB}
          <code className="font-mono text-xs">site.maintenance</code>.
          {!dbReady && <span className="mt-1.5 block text-rose-600">{s.maintDbWarning}</span>}
        </p>

        <label className="mt-4 flex items-center gap-2.5 text-sm font-medium text-text-main">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={saving}
            className="h-5 w-5"
          />
          {s.maintEnabled}
        </label>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">{s.maintMsgBn}</span>
            <textarea
              rows={3}
              value={messageBn}
              onChange={(e) => setMessageBn(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{s.maintMsgEn}</span>
            <textarea
              rows={3}
              value={messageEn}
              onChange={(e) => setMessageEn(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block grow basis-56">
            <span className="text-sm font-medium">{s.reasonRequiredShort}</span>
            <input
              type="text"
              placeholder={s.maintReasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? s.saving : s.save}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-lg border px-4 py-3.5 text-sm ${
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
