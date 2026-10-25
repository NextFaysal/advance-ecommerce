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
function percentToBps(input: string): { bps: number } | { error: string } {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return { error: "শতকরা হারটি সঠিকভাবে লিখুন — যেমন 15 বা 7.5 (সর্বোচ্চ দুই দশমিক ঘর)।" };
  }
  const whole = Number(match[1] as string);
  const frac = match[2] ? Number((match[2] as string).padEnd(2, "0")) : 0;
  const bps = whole * 100 + frac;
  if (bps > 10000) return { error: "VAT হার 100%-এর বেশি হতে পারে না।" };
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
  const [currentBps, setCurrentBps] = useState<number | null>(initialBps);
  const [storedRaw, setStoredRaw] = useState<string>(initialRaw);
  const [percent, setPercent] = useState<string>(initialBps !== null ? formatBpsAsPercent(initialBps) : "");
  const [reason, setReason] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [statusOk, setStatusOk] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const trimmed = percent.trim();
  const parsed = trimmed === "" ? null : percentToBps(trimmed);
  const previewBps = parsed !== null && "bps" in parsed ? parsed.bps : null;

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    let valueToStore = "";
    let nextBps: number | null = null;
    if (trimmed !== "") {
      const result = percentToBps(trimmed);
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
        setStatus(data.error?.message ?? `সেভ করা যায়নি (${res.status})।`);
        return;
      }
      setCurrentBps(nextBps);
      setStoredRaw(valueToStore);
      setStatusOk(true);
      setStatus(
        nextBps !== null
          ? `সেভ হয়েছে — এখন থেকে নতুন অর্ডারে ${formatBpsAsPercent(nextBps)}% হারে VAT বিভাজন সংরক্ষিত হবে।`
          : "সেভ হয়েছে — VAT বিভাজন এখন বন্ধ; নতুন অর্ডারে কোনো VAT বিভাজন সংরক্ষিত হবে না।",
      );
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — কিছুই সেভ হয়নি।");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4 shadow-card">
      <h2 className="font-semibold">VAT হার (বিক্রয়)</h2>

      <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
        বর্তমানে কার্যকর:{" "}
        {currentBps !== null ? (
          <strong className="text-emerald-600">{formatBpsAsPercent(currentBps)}% ({currentBps} bps)</strong>
        ) : (
          <strong>বন্ধ — কোনো হার সেট করা নেই</strong>
        )}
        {!dbReady && (
          <span className="mt-1 block text-rose-600">
            সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — উপরের অবস্থা নির্ভরযোগ্য নয়। সেভ করলে সার্ভার ত্রুটি দেখালে কিছুই বদলাবে না।
          </span>
        )}
        {dbReady && currentBps === null && storedRaw.trim() !== "" && (
          <span className="mt-1 block text-text-muted">
            (সেভ করা মান <code className="font-mono text-xs">{storedRaw}</code> বৈধ হার নয় — তাই এখন বন্ধ হিসেবেই ধরা হচ্ছে। নিচে সঠিক হার সেভ করলেই ঠিক হয়ে যাবে।)
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-sm font-medium">VAT হার (%)</span>
          <span className="mt-1 flex items-center gap-1">
            <input
              type="text"
              inputMode="decimal"
              placeholder="যেমন 15"
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              disabled={saving}
              className="min-h-[44px] w-36 rounded-md border border-border bg-card px-3 text-sm"
            />
            <span className="text-sm text-text-muted">%</span>
          </span>
        </label>
        <label className="block grow">
          <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিটের জন্য আবশ্যিক)</span>
          <input
            type="text"
            placeholder="যেমন: নতুন অর্থবছর থেকে VAT হার 15%"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={saving}
            className="mt-1 block min-h-[44px] w-full max-w-md rounded-md border border-border bg-card px-3 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "সেভ হচ্ছে…" : "সেভ করুন"}
        </button>
      </div>

      <p className="mt-2 text-sm text-text-muted">
        {trimmed === ""
          ? "ঘর খালি রেখে সেভ করলে VAT বিভাজন বন্ধ হয়ে যাবে।"
          : parsed !== null && "error" in parsed
            ? parsed.error
            : previewBps !== null && previewBps > 0
              ? `সংরক্ষিত হবে ${previewBps} bps হিসেবে (${formatBpsAsPercent(previewBps)}%)।`
              : "0% — সেভ করলে VAT বিভাজন বন্ধ হয়ে যাবে।"}
      </p>

      {status && (
        <p
          className={`mt-3 rounded-md border px-3 py-2 text-sm ${
            statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {status}
        </p>
      )}
    </section>
  );
}
