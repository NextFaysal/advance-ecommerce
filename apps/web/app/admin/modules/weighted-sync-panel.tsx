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

interface SyncReport {
  checked: number;
  updated: Array<{ variantId: string; sku: string; fromPoisha: number; toPoisha: number }>;
  unchanged: number;
  missingVariantIds: string[];
}

function bdt(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("bn-BD", { maximumFractionDigits: 2 })}`;
}

export function WeightedSyncPanel() {
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
        setError(json?.error?.message ?? "Sync চালানো যায়নি।");
        return;
      }
      setReport(json.data as SyncReport);
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="max-w-xl text-sm text-text-muted">
        গ্রোসারি প্যাকের weightedVariants কনফিগ অনুযায়ী প্রতিটি ওজন প্যাকের দাম (প্রতি কেজি হার ×
        প্যাকের ওজন) ভ্যারিয়েন্টের রেকর্ডকৃত দামে লিখে দেয় — চেকআউটে ওই রেকর্ডকৃত দামই চার্জ হয়।
        হার বদলালে আবার sync করুন; sync না হওয়া পর্যন্ত আগের দামই প্রযোজ্য থাকে।
      </p>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="mt-3 h-11 rounded-xl bg-indigo-600 px-5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Sync হচ্ছে…" : "ওজন প্যাকের দাম sync করুন"}
      </button>
      {error ? (
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      ) : null}
      {report ? (
        <div className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-sm leading-6 text-text-muted">
          <p>
            যাচাই হয়েছে: <strong className="text-text-main">{report.checked}</strong>টি প্যাক ·
            অপরিবর্তিত: <strong className="text-text-main">{report.unchanged}</strong>টি · হালনাগাদ:{" "}
            <strong className="text-text-main">{report.updated.length}</strong>টি
          </p>
          {report.updated.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {report.updated.map((u) => (
                <li key={u.variantId} className="font-mono text-[13px]">
                  {u.sku}: {bdt(u.fromPoisha)} → {bdt(u.toPoisha)}
                </li>
              ))}
            </ul>
          ) : null}
          {report.missingVariantIds.length > 0 ? (
            <p className="mt-1.5 text-amber-700">
              কনফিগে থাকলেও খুঁজে পাওয়া যায়নি (মুছে ফেলা হয়েছে?): {report.missingVariantIds.join(", ")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
