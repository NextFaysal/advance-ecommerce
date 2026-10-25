"use client";

/**
 * POS sales panel (doc 17, batch O9-2) — mounted on the admin orders
 * page under the KPI panel so the orders team can see the physical
 * counter's sales next to the online orders. Data: GET
 * /api/v1/admin/orders/pos-sales (src/orders/pos-sales), range select
 * mirrors the KPI panel (today / last 7 / last 30 Dhaka days).
 *
 * READ-ONLY by design, and the copy says why: a POS sale already
 * moved its stock inside the POS flow, so these sales are reported
 * here — never converted into Orders (that would double-count stock
 * and revenue). The register itself lives at /admin/pos.
 */
import { useEffect, useState } from "react";
import { formatBdt } from "../../../src/checkout/pricing";
import { shiftYmd, todayDhakaYmd } from "../../../src/lib/dhaka-date";

interface PosSaleRow {
  id: string;
  receiptRef: string;
  createdAt: string;
  totalPoisha: number;
  paymentMethod: string;
  itemsCount: number;
  cashierLabel?: string;
  registerName?: string;
}

interface PosSalesReport {
  range: { from: string; to: string };
  rows: PosSaleRow[];
  count: number;
  totalPoisha: number;
  rowsTruncated: boolean;
}

type RangeKey = "today" | "7d" | "30d";

const RANGE_OPTIONS: Array<{ key: RangeKey; label: string; days: number }> = [
  { key: "today", label: "আজ", days: 0 },
  { key: "7d", label: "শেষ ৭ দিন", days: 6 },
  { key: "30d", label: "শেষ ৩০ দিন", days: 29 },
];

const METHOD_LABEL: Record<string, string> = {
  CASH: "নগদ",
  BKASH: "বিকাশ",
  NAGAD: "নগদ (Nagad)",
  CARD: "কার্ড",
};

function rangeFor(key: RangeKey): { from: string; to: string } {
  const to = todayDhakaYmd();
  const days = RANGE_OPTIONS.find((o) => o.key === key)?.days ?? 29;
  return { from: shiftYmd(to, -days), to };
}

export function PosSalesPanel() {
  const [rangeKey, setRangeKey] = useState<RangeKey>("30d");
  const [report, setReport] = useState<PosSalesReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    (async () => {
      try {
        const { from, to } = rangeFor(rangeKey);
        const res = await fetch(`/api/v1/admin/orders/pos-sales?from=${from}&to=${to}`);
        const body = (await res.json().catch(() => null)) as { data?: PosSalesReport } | null;
        if (cancelled) return;
        if (res.ok && body?.data) setReport(body.data);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rangeKey]);

  return (
    <section aria-label="দোকানের বিক্রি (POS)" className="mt-4 rounded-lg border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-h3">দোকানের বিক্রি (POS)</h2>
          <p className="mt-0.5 max-w-2xl text-small leading-relaxed text-text-muted">
            কাউন্টারের বিক্রি এখানে শুধু দেখার জন্য — এগুলো অর্ডারে রূপান্তর হয় না, কারণ POS বিক্রির স্টক
            POS ফ্লোতেই কমে গেছে (রূপান্তর করলে স্টক ও আয় দুবার গণনা হতো)। বিক্রি করতে{" "}
            <a href="/admin/pos" className="font-semibold text-brand-700 hover:underline">
              POS রেজিস্টার
            </a>{" "}
            ব্যবহার করুন।
          </p>
        </div>
        <div className="flex gap-1.5" role="group" aria-label="সময়সীমা">
          {RANGE_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => setRangeKey(o.key)}
              aria-pressed={rangeKey === o.key}
              className={`min-h-[36px] rounded-md px-3 text-small font-semibold transition motion-fast ${
                rangeKey === o.key
                  ? "bg-brand-600 text-white"
                  : "border border-border bg-card hover:bg-surface-2"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {failed && (
        <p role="alert" className="mt-3 text-small text-rose-600">
          POS বিক্রি লোড করা যায়নি।
        </p>
      )}
      {!failed && !report && (
        <p role="status" className="mt-3 text-small text-text-muted">
          লোড হচ্ছে…
        </p>
      )}
      {report && (
        <>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-small">
            <span>
              মোট বিক্রি:{" "}
              <span className="font-mono font-bold tabular-nums">{formatBdt(report.totalPoisha)}</span>
            </span>
            <span className="text-text-muted">
              {report.count.toLocaleString("bn-BD")}টি রসিদ
              {report.rowsTruncated ? ` (সর্বশেষ ${report.rows.length.toLocaleString("bn-BD")}টি দেখানো হচ্ছে; মোট হিসাব পুরো সময়সীমার)` : ""}
            </span>
          </div>
          {report.rows.length === 0 ? (
            <p className="mt-3 text-small text-text-muted">এই সময়সীমায় কোনো POS বিক্রি নেই।</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-small">
                <thead>
                  <tr className="border-b border-border text-caption uppercase tracking-wide text-text-subtle">
                    <th className="py-2 pr-3 font-semibold">রসিদ</th>
                    <th className="py-2 pr-3 font-semibold">সময়</th>
                    <th className="py-2 pr-3 font-semibold">ক্যাশিয়ার / কাউন্টার</th>
                    <th className="py-2 pr-3 font-semibold">পেমেন্ট</th>
                    <th className="py-2 pr-3 text-right font-semibold">পণ্য</th>
                    <th className="py-2 text-right font-semibold">মোট</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {report.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 font-mono font-semibold">{r.receiptRef}</td>
                      <td className="py-2 pr-3 text-text-muted">
                        {new Date(r.createdAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
                      </td>
                      <td className="py-2 pr-3 text-text-muted">
                        {[r.cashierLabel, r.registerName].filter(Boolean).join(" · ") || "—"}
                      </td>
                      <td className="py-2 pr-3">{METHOD_LABEL[r.paymentMethod] ?? r.paymentMethod}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.itemsCount.toLocaleString("bn-BD")}</td>
                      <td className="py-2 text-right font-mono font-semibold tabular-nums">
                        {formatBdt(r.totalPoisha)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
