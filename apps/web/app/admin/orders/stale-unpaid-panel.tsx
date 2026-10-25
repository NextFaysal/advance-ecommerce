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
import { Badge } from "../../../src/components/ui/badge";
import { Icon } from "../../../src/components/ui/icon";
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

/* OD6 (doc 19 §3-S6) — age ramp + label in the aging panel's language
 * (app/admin/orders/aging-panel.tsx): identical thresholds and the
 * "{age} ধরে আটকে" phrasing, so a stuck order reads the same here as
 * on the aging board. */
function ageChipClass(ageHours: number): string {
  if (ageHours >= 7 * 24) return "bg-rose-100 text-rose-800";
  if (ageHours >= 5 * 24) return "bg-orange-100 text-orange-800";
  if (ageHours >= 48) return "bg-amber-100 text-amber-800";
  return "bg-yellow-50 text-yellow-800";
}

function ageLabel(ageHours: number): string {
  if (ageHours >= 48) return `${Math.floor(ageHours / 24)} দিন`;
  return `${Math.round(ageHours)} ঘণ্টা`;
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
        <Badge tone="warning" icon={<Icon name="clock" size={12} />}>
          {meta.total}টি বকেয়া
        </Badge>
        <p className="text-body font-medium text-amber-900">
          অগ্রিম/প্রিপেইড বকেয়া অর্ডার {meta.hours} ঘণ্টার বেশি পুরনো
        </p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="ml-auto rounded-md border border-amber-300 bg-surface px-3 py-1.5 text-small font-medium text-amber-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          aria-expanded={expanded}
        >
          {expanded ? "লুকান" : "তালিকা দেখুন"}
        </button>
      </div>
      <p className="mt-2 text-small text-amber-800">
        স্বয়ংক্রিয় বাতিল চালু নেই — VPS ওয়ার্কার এলে চালু হবে। তালিকা ধরে ম্যানুয়ালি ফলো-আপ করুন।
      </p>
      {expanded && (
        <ul className="mt-3 divide-y divide-amber-200 rounded-md border border-amber-200 bg-surface">
          {data.map((row) => (
            <li key={row.id} className="flex flex-col gap-1.5 px-3 py-2 text-small sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4">
              <Link href={`/admin/orders/${row.id}`} className="font-semibold text-brand-700 hover:underline">
                {row.orderNo}
              </Link>
              <span
                className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageHours)}`}
              >
                {ageLabel(row.ageHours)} ধরে আটকে
              </span>
              <span>{METHOD_LABEL[row.paymentMethod] ?? row.paymentMethod}</span>
              <span>মোট {formatBdt(row.totalPoisha)}</span>
              {row.advanceRequiredPoisha > 0 ? (
                row.advanceSatisfied ? (
                  <Badge tone="success" icon={<Icon name="check" size={12} />}>
                    অগ্রিম পরিশোধিত {formatBdt(row.advanceRequiredPoisha)}
                  </Badge>
                ) : (
                  <Badge tone="warning" icon={<Icon name="clock" size={12} />}>
                    অগ্রিম বাকি {formatBdt(row.advanceRequiredPoisha)}
                  </Badge>
                )
              ) : null}
              <span className="text-text-muted sm:ml-auto">{row.customerPhoneMasked}</span>
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
