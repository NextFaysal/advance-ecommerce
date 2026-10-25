"use client";

/**
 * Failed-delivery cost ledger panel (doc 17, batch O8-2) — a section
 * on the ERP page, fed by GET /api/v1/admin/orders/delivery-costs.
 *
 * Shows what failed / returned deliveries actually cost: the courier
 * charge that was booked for each such order (Σ Shipment.chargePoisha
 * from the server read model). The return-leg charge has NO record
 * on any booking, so the column says "রেকর্ড নেই" (not recorded) —
 * never a guessed number, never a silent zero — and the summary
 * counts how many orders carry that unknown.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import { shiftYmd, todayDhakaYmd } from "@/lib/dhaka-date";

interface DeliveryCostRow {
  orderId: string;
  orderNo: string;
  status: string;
  reachedFailed: boolean;
  reachedReturned: boolean;
  outboundChargePoisha: number;
  returnChargePoisha: number | null;
  returnCostRecorded: boolean;
  totalKnownCostPoisha: number;
}

interface DeliveryCostsData {
  range: { from: string; to: string };
  rows: DeliveryCostRow[];
  summary: {
    failedCount: number;
    returnedCount: number;
    knownCostPoisha: number;
    ordersWithUnknownReturnCost: number;
  };
  truncated: boolean;
}

const inputClass =
  "rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500";

export function DeliveryCostsPanel() {
  const [to, setTo] = useState(todayDhakaYmd());
  const [from, setFrom] = useState(shiftYmd(todayDhakaYmd(), -29));
  const [data, setData] = useState<DeliveryCostsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/orders/delivery-costs?from=${from}&to=${to}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { data: DeliveryCostsData };
        if (!cancelled) setData(json.data);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        ব্যর্থ ও ফেরত ডেলিভারিতে বুক করা কুরিয়ার চার্জের হিসাব — প্রতিটি অর্ডারের আসল বুকিং চার্জ
        (Shipment রেকর্ড থেকে)। ফেরত পথের (return-leg) চার্জ কোনো বুকিং রেকর্ডে থাকে না, তাই সেই ঘরে
        "রেকর্ড নেই" দেখানো হয় — অনুমান করে সংখ্যা বসানো হয় না; মোট জানা খরচ শুধু যাওয়ার চার্জ।
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">থেকে (yyyy-mm-dd)</span>
          <input type="text" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">পর্যন্ত (yyyy-mm-dd)</span>
          <input type="text" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
        {loading ? <span className="pb-2 text-xs text-text-muted">লোড হচ্ছে…</span> : null}
      </div>

      {failed ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          ডেলিভারি খরচের হিসাব লোড হয়নি — আবার চেষ্টা করুন।
        </p>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">ব্যর্থ ডেলিভারি</p>
              <p className="mt-1 text-base font-semibold">{data.summary.failedCount}টি</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">ফেরত এসেছে</p>
              <p className="mt-1 text-base font-semibold">{data.summary.returnedCount}টি</p>
            </div>
            <div className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-xs text-text-muted">মোট জানা খরচ (যাওয়ার চার্জ)</p>
              <p className="mt-1"><Money poisha={data.summary.knownCostPoisha} /></p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs text-amber-800">ফেরত পথের খরচ জানা নেই</p>
              <p className="mt-1 text-base font-semibold text-amber-900">
                {data.summary.ordersWithUnknownReturnCost}টি অর্ডার
              </p>
            </div>
          </div>

          {data.rows.length > 0 ? (
            <DataTable
              caption={`ব্যর্থ/ফেরত ডেলিভারির খরচ — ${data.range.from} থেকে ${data.range.to}${data.truncated ? " (প্রথম ২০০টি দেখানো হচ্ছে)" : ""}`}
              columns={[
                { key: "order", header: "অর্ডার" },
                { key: "outcome", header: "পরিণতি" },
                { key: "outbound", header: "যাওয়ার কুরিয়ার চার্জ" },
                { key: "returnLeg", header: "ফেরত পথের চার্জ" },
                { key: "total", header: "মোট জানা খরচ" },
              ]}
              rows={data.rows.map((r) => ({
                order: (
                  <Link href={`/admin/orders/${r.orderId}`} className="font-mono text-xs text-brand-600 hover:underline">
                    {r.orderNo}
                  </Link>
                ),
                outcome: (
                  <span className="flex flex-wrap gap-1">
                    {r.reachedFailed ? <Badge tone="danger">ডেলিভারি ব্যর্থ</Badge> : null}
                    {r.reachedReturned ? <Badge tone="warning">ফেরত এসেছে</Badge> : null}
                    {!r.reachedFailed && !r.reachedReturned ? <Badge tone="neutral">{r.status}</Badge> : null}
                  </span>
                ),
                outbound: <Money poisha={r.outboundChargePoisha} />,
                returnLeg: r.returnCostRecorded && r.returnChargePoisha !== null ? (
                  <Money poisha={r.returnChargePoisha} />
                ) : (
                  <span className="text-xs text-text-muted">রেকর্ড নেই</span>
                ),
                total: <span className="font-medium">{formatPoisha(r.totalKnownCostPoisha)}</span>,
              }))}
            />
          ) : (
            <p className="text-sm text-text-muted">
              এই পরিসরে কোনো ব্যর্থ বা ফেরত ডেলিভারি নেই — খরচও নেই।
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
      )}
    </div>
  );
}
