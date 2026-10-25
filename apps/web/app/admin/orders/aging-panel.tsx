"use client";

/**
 * Orders aging / stuck board panel (doc 17, O6-2) — mounted on the
 * admin orders page under StaleUnpaidPanel. Fetches
 * GET /api/v1/admin/orders/aging and renders a compact amber card
 * ONLY when at least one bucket is non-empty (all-zero renders
 * nothing — the orders page stays clean). Buckets: pending >24h,
 * confirmed-unpacked >48h, shipped-undelivered >5d, returning >7d;
 * each shows its full count and, when expanded, the 10 oldest
 * orders (masked phones only — the endpoint never returns a full
 * number).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBdt } from "../../../src/checkout/pricing";

interface AgingOrderRow {
  id: string;
  orderNo: string;
  status: string;
  ageHours: number;
  totalPoisha: number;
  customerPhoneMasked: string;
}

interface AgingBucket {
  key: string;
  labelBn: string;
  labelEn: string;
  count: number;
  orders: AgingOrderRow[];
}

interface AgingResponse {
  data: AgingBucket[];
  meta: { totalStuck: number };
}

function ageLabel(ageHours: number): string {
  if (ageHours >= 48) return `${Math.floor(ageHours / 24)} দিন`;
  return `${Math.round(ageHours)} ঘণ্টা`;
}

export function AgingPanel() {
  const [state, setState] = useState<AgingResponse | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/orders/aging");
        if (!res.ok) return;
        const json = (await res.json()) as AgingResponse;
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

  if (state === null || state.meta.totalStuck === 0) return null;
  const buckets = state.data.filter((b) => b.count > 0);

  return (
    <section className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-card" aria-label="আটকে থাকা অর্ডার">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center rounded-full bg-amber-500 px-2.5 py-0.5 text-small font-semibold text-white">
          {state.meta.totalStuck}টি
        </span>
        <p className="text-body font-medium text-amber-900">
          আটকে থাকা অর্ডার — অনেকক্ষণ ধরে একই অবস্থায় আছে
        </p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {buckets.map((bucket) => {
          const expanded = expandedKey === bucket.key;
          return (
            <div key={bucket.key} className="rounded-md border border-amber-200 bg-white">
              <button
                type="button"
                onClick={() => setExpandedKey(expanded ? null : bucket.key)}
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
              >
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 font-mono text-small font-semibold tabular-nums text-amber-900">
                  {bucket.count}
                </span>
                <span className="text-small font-medium text-amber-900">{bucket.labelBn}</span>
                <span className="ml-auto text-small font-medium text-amber-800">{expanded ? "লুকান" : "দেখুন"}</span>
              </button>
              {expanded && (
                <ul className="divide-y divide-amber-100 border-t border-amber-100">
                  {bucket.orders.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-small">
                      <Link href={`/admin/orders/${row.id}`} className="font-semibold text-indigo-700 hover:underline">
                        {row.orderNo}
                      </Link>
                      <span className="text-text-muted">{ageLabel(row.ageHours)} ধরে</span>
                      <span>মোট {formatBdt(row.totalPoisha)}</span>
                      <span className="ml-auto text-text-muted">{row.customerPhoneMasked}</span>
                    </li>
                  ))}
                  {bucket.count > bucket.orders.length && (
                    <li className="px-3 py-2 text-small text-text-muted">
                      আরও {bucket.count - bucket.orders.length}টি এই তালিকার বাইরে (সবচেয়ে পুরনো {bucket.orders.length}টি দেখানো হচ্ছে)।
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
