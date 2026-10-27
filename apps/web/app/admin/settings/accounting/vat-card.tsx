"use client";

// VAT rate card — Settings > Accounting (wave 16).
// Edits the existing Settings key `accounting.vat_rate_bps` through
// the standard Settings API (POST /api/v1/admin/settings
// { key, value, reason }) — the API's setSetting() writes the audit
// row, and a reason is required. The merchant types a PERCENT
// (15 = 15%); the stored value is integer basis points (15% = 1500).
// Empty input or 0 saves an EMPTY value, which is the documented OFF
// state: readConfiguredVatRateBps treats unset/blank/0 as "no VAT
// split recorded on orders". This card changes no VAT math anywhere.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "../strings";

const VAT_SETTING_KEY = "accounting.vat_rate_bps";

/** bps -> percent text without trailing zeros: 1500 -> "15", 1550 -> "15.5", 1505 -> "15.05". */
function formatBpsAsPercent(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

/**
 * Percent text -> integer bps with exact decimal-string math (never
 * float multiplication): at most two decimal places, because bps is
 * an integer (15.55% = 1555 bps; 15.555% has no exact bps value and
 * is rejected rather than rounded silently).
 */
function percentToBps(input: string, s: { vatPercentError: string; vatOverError: string }): { bps: number } | { error: string } {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return { error: s.vatPercentError };
  }
  const whole = Number(match[1] as string);
  const frac = match[2] ? Number((match[2] as string).padEnd(2, "0")) : 0;
  const bps = whole * 100 + frac;
  if (bps > 10000) return { error: s.vatOverError };
  return { bps };
}

interface VatRateCardProps {
  /** Effective rate right now (the same parse the order flow uses); null = off. */
  initialBps: number | null;
  /** Raw stored value, for the honest "stored but invalid" note. */
  initialRaw: string;
  dbReady: boolean;
}

export function VatRateCard({ initialBps, initialRaw, dbReady }: VatRateCardProps) {
  const { locale, t } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);
  const [currentBps, setCurrentBps] = useState<number | null>(initialBps);
  const [storedRaw, setStoredRaw] = useState<string>(initialRaw);
  const [percent, setPercent] = useState<string>(initialBps !== null ? formatBpsAsPercent(initialBps) : "");
  const [reason, setReason] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const trimmed = percent.trim();
  const parsed = trimmed === "" ? null : percentToBps(trimmed, s);
  const previewBps = parsed !== null && "bps" in parsed ? parsed.bps : null;

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus(s.reasonRequired);
      return;
    }
    let valueToStore = "";
    let nextBps: number | null = null;
    if (trimmed !== "") {
      const result = percentToBps(trimmed, s);
      if ("error" in result) {
        setStatusOk(false);
        setStatus(result.error);
        return;
      }
      if (result.bps > 0) {
        valueToStore = String(result.bps);
        nextBps = result.bps;
      }
      // bps === 0 falls through: stores "" (the OFF state).
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: VAT_SETTING_KEY, value: valueToStore, reason: reason.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setStatusOk(false);
        setStatus(data.error?.message ?? interpolate(s.saveFailedDot, { status: res.status }));
        return;
      }
      setCurrentBps(nextBps);
      setStoredRaw(valueToStore);
      setStatusOk(true);
      setStatus(
        nextBps !== null
          ? interpolate(s.vatSavedOn, { pct: formatBpsAsPercent(nextBps) })
          : s.vatSavedOff,
      );
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
          <Icon name="banknote" size={20} />
        </span>
        <h2 className="font-display text-base font-semibold text-text-main">{s.vatTitle}</h2>
      </div>

      <div
        className={`mt-4 rounded-xl border px-4 py-3.5 text-sm ${
          currentBps !== null ? "border-emerald-200 bg-emerald-50/70" : "border-border bg-surface-2"
        }`}
      >
        <p className="flex flex-wrap items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${currentBps !== null ? "bg-emerald-500" : "bg-slate-400"}`}
          />
          {s.currentlyEffective}{" "}
          {currentBps !== null ? (
            <strong className="font-mono text-base text-emerald-700">{formatBpsAsPercent(currentBps)}% ({currentBps} bps)</strong>
          ) : (
            <strong>{s.vatEffectiveOff}</strong>
          )}
        </p>
        {!dbReady && (
          <span className="mt-1.5 block leading-relaxed text-rose-600">
            {s.dbWarningShort}
          </span>
        )}
        {dbReady && currentBps === null && storedRaw.trim() !== "" && (
          <span className="mt-1.5 block leading-relaxed text-text-muted">
            {s.vatInvalidNoteA}<code className="font-mono text-xs">{storedRaw}</code>{s.vatInvalidNoteB}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">{s.vatRateLabel}</span>
          <span className="mt-1 flex items-center gap-1.5">
            <input
              type="text"
              inputMode="decimal"
              placeholder={s.vatPlaceholder}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              disabled={saving}
              className="min-h-[44px] w-36 rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
            />
            <span className="text-sm text-text-muted">%</span>
          </span>
        </label>
        <label className="block grow basis-56">
          <span className="text-sm font-medium">{s.reasonLabel}</span>
          <input
            type="text"
            placeholder={s.vatReasonPlaceholder}
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
          {saving ? t.saving : s.vatSave}
        </button>
      </div>

      <p className="mt-2 text-sm text-text-muted">
        {trimmed === ""
          ? s.vatEmptyHint
          : parsed !== null && "error" in parsed
            ? parsed.error
            : previewBps !== null && previewBps > 0
              ? interpolate(s.vatWillStore, { bps: previewBps, pct: formatBpsAsPercent(previewBps) })
              : s.vatZeroHint}
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
