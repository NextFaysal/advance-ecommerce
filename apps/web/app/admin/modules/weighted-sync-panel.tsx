"use client";

/**
 * Grocery weighted-price sync panel (ADV-22) — mounted on Admin >
 * Modules while the grocery pack is enabled. One button runs the
 * sync action (per-kg rate × pack grams → recorded variant prices)
 * and renders the server's report verbatim: every price it changed
 * (from → to), how many already matched, and any configured variant
 * that no longer exists. Nothing is claimed beyond the report.
 */
import { useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { MODULES_STRINGS } from "./strings";

interface SyncReport {
  checked: number;
  updated: Array<{ variantId: string; sku: string; fromPoisha: number; toPoisha: number }>;
  unchanged: number;
  missingVariantIds: string[];
}

function bdt(poisha: number, locale: "bn" | "en"): string {
  return `৳${(poisha / 100).toLocaleString(intlLocale(locale), { maximumFractionDigits: 2 })}`;
}

export function WeightedSyncPanel() {
  const { locale } = useLocale();
  const s = pick(locale, MODULES_STRINGS);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/grocery/weighted-prices/sync", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error?.message ?? s.syncFailed);
        return;
      }
      setReport(json.data as SyncReport);
    } catch {
      setError(s.networkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="max-w-xl text-sm text-text-muted">
        {s.syncDesc}
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="mt-3 h-11 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-xs transition hover:bg-brand-700 disabled:opacity-60"
      >
        {busy ? s.syncing : s.syncBtn}
      </button>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="mt-3 rounded-2xl border border-border/60 bg-surface-2 px-4 py-3 text-sm leading-6 text-text-muted">
          <p>
            {interpolate(s.syncReport, { checked: report.checked, unchanged: report.unchanged, updated: report.updated.length })}
          </p>
          {report.updated.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {report.updated.map((u) => (
                <li key={u.variantId} className="tnum font-mono text-[13px]">
                  {u.sku}: {bdt(u.fromPoisha, locale)} → {bdt(u.toPoisha, locale)}
                </li>
              ))}
            </ul>
          ) : null}
          {report.missingVariantIds.length > 0 ? (
            <p className="mt-1.5 text-amber-700 dark:text-amber-300">
              {interpolate(s.syncMissing, { ids: report.missingVariantIds.join(", ") })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
