"use client";

/**
 * Stale-unpaid work list panel (doc 17, O3) — mounted on the admin
 * orders page. Fetches GET /api/v1/admin/orders/stale-unpaid?hours=24
 * and renders a compact warning card ONLY when stale orders exist
 * (a zero state renders nothing — the orders page stays clean).
 * Expanding shows the rows: order link, age, total, advance due,
 * method, masked phone (the endpoint never returns a full number).
 *
 * The copy is deliberately honest: automatic cancellation is NOT
 * active (it arrives with the VPS worker) — this is a list for staff
 * to work by hand, not a sweep.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "../../../src/checkout/pricing";

interface StaleRow {
  id: string;
  orderNo: string;
  createdAt: string;
  ageHours: number;
  totalPoisha: number;
  advanceRequiredPoisha: number;
  advanceSatisfied: boolean;
  paymentMethod: string;
  customerPhoneMasked: string;
}

interface StaleResponse {
  data: StaleRow[];
  meta: { total: number; hours: number; autoCancelActive: boolean };
}

const METHOD_LABEL: Record<string, string> = {
  COD: "ক্যাশ অন ডেলিভারি",
  BKASH: "বিকাশ",
  NAGAD: "নগদ",
  ROCKET: "রকেট",
  UPAY: "উপায়",
  SSLCOMMERZ: "SSLCommerz",
  AAMARPAY: "আমারপে",
  SHURJOPAY: "সূর্যপে",
  MANUAL_MOBILE_BANKING: "ম্যানুয়াল মোবাইল ব্যাংকিং",
};

export function StaleUnpaidPanel() {
  const [state, setState] = useState<StaleResponse | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/orders/stale-unpaid?hours=24");
        if (!res.ok) return;
        const json = (await res.json()) as StaleResponse;
        if (!cancelled) setState(json);
      } catch {
        // Silent: the panel is an add-on — the orders list below is
        // the page's real job and must not be disturbed by it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === null || state.meta.total === 0) return null;
  const { data, meta } = state;

  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-card" aria-label="বকেয়া অনপেইড অর্ডার">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-small font-semibold text-white">
          {meta.total}টি
        </span>
        <p className="text-body font-medium text-amber-900">
          অগ্রিম/প্রিপেইড বকেয়া অর্ডার {meta.hours} ঘণ্টার বেশি পুরনো
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto rounded-md border border-amber-300 bg-white px-3 py-1.5 text-small font-medium text-amber-900"
          aria-expanded={expanded}
        >
          {expanded ? "লুকান" : "তালিকা দেখুন"}
        </button>
      </div>
      <p className="mt-2 text-small text-amber-800">
        স্বয়ংক্রিয় বাতিল চালু নেই — VPS ওয়ার্কার এলে চালু হবে। তালিকা ধরে ম্যানুয়ালি ফলো-আপ করুন।
      </p>
      {expanded && (
        <ul className="mt-3 divide-y divide-amber-200 rounded-md border border-amber-200 bg-white">
          {data.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-small">
              <Link href={`/admin/orders/${row.id}`} className="font-semibold text-indigo-700 hover:underline">
                {row.orderNo}
              </Link>
              <span className="text-text-muted">{row.ageHours} ঘণ্টা পুরনো</span>
              <span>{METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}</span>
              <span>
                মোট {formatBdt(row.totalPoisha)}
                {row.advanceRequiredPoisha > 0 && (
                  <>
                    {" "}· অগ্রিম {formatBdt(row.advanceRequiredPoisha)}
                    {row.advanceSatisfied ? " (পরিশোধিত)" : " (বাকি)"}
                  </>
                )}
              </span>
              <span className="ml-auto text-text-muted">{row.customerPhoneMasked}</span>
            </li>
          ))}
          {meta.total > data.length && (
            <li className="px-3 py-2 text-small text-text-muted">
              আরও {meta.total - data.length}টি অর্ডার তালিকার বাইরে রয়েছে (সর্বোচ্চ {data.length}টি দেখানো হয়)।
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
