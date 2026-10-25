"use client";

/**
 * Orders aging / stuck board panel (doc 17, O6-2; design OD5, doc 19)
 * — mounted on the admin orders page under StaleUnpaidPanel. Fetches
 * GET /api/v1/admin/orders/aging and renders the board ONLY when at
 * least one bucket is non-empty (all-zero renders nothing — the
 * orders page stays clean). Buckets: pending >24h, confirmed-unpacked
 * >48h, shipped-undelivered >5d, returning >7d; each shows its full
 * count and, when expanded, the 10 oldest orders (masked phones only
 * — the endpoint never returns a full number).
 *
 * OD5 design: bucket cards carry an AGE COLOUR RAMP (amber → orange →
 * rose as the stuck threshold grows) and per-row age chips ramp the
 * same way. Actions stay honest: the aging API is GET-only and there
 * is NO order-scoped call-task endpoint the board could call (the
 * abandoned call-task endpoint is keyed to AbandonedCheckout ids, and
 * this board only ever holds masked phones by design) — so each row's
 * action is the link into the order workspace, where staff act
 * (assign, call, transition). No invented endpoints, no fake buttons.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
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

/* Ramp per bucket key (thresholds 24h → 48h → 5d → 7d): the longer
 * an order may sit stuck, the hotter its card header runs. Unknown
 * future keys fall back to the first (mildest) step. */
const BUCKET_RAMP: Record<string, { icon: IconName; chip: string; header: string }> = {
  pending_old: {
    icon: "clock",
    chip: "bg-amber-100 text-amber-900",
    header: "border-amber-200",
  },
  confirmed_unpacked: {
    icon: "package",
    chip: "bg-amber-200 text-amber-900",
    header: "border-amber-300",
  },
  shipped_undelivered: {
    icon: "truck",
    chip: "bg-orange-200 text-orange-900",
    header: "border-orange-300",
  },
  returning_stuck: {
    icon: "rotate-ccw",
    chip: "bg-rose-200 text-rose-900",
    header: "border-rose-300",
  },
};

/* Per-row age ramp: how long THIS order has been stuck. */
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-0.5 text-small font-semibold text-white">
          <Icon name="alert" size={14} />
          {state.meta.totalStuck}টি
        </span>
        <p className="text-body font-medium text-amber-900">
          আটকে থাকা অর্ডার — অনেকক্ষণ ধরে একই অবস্থায় আছে
        </p>
        <p className="text-caption text-amber-800">
          অর্ডার খুললেই সেখানে কাজ করা যাবে (দায়িত্ব দেওয়া, কল, স্ট্যাটাস বদল)।
        </p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {buckets.map((bucket) => {
          const expanded = expandedKey === bucket.key;
          const ramp = BUCKET_RAMP[bucket.key] ?? BUCKET_RAMP.pending_old;
          return (
            <div key={bucket.key} className={`overflow-hidden rounded-md border bg-surface ${ramp.header}`}>
              <button
                type="button"
                onClick={() => setExpandedKey(expanded ? null : bucket.key)}
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-small font-semibold tabular-nums ${ramp.chip}`}>
                  <Icon name={ramp.icon} size={13} />
                  {bucket.count}
                </span>
                <span className="text-small font-medium text-amber-900">{bucket.labelBn}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-small font-medium text-amber-800">
                  {expanded ? "লুকান" : "দেখুন"}
                  <Icon name="chevron-down" size={14} className={expanded ? "rotate-180 transition" : "transition"} />
                </span>
              </button>
              {expanded && (
                <ul className="divide-y divide-amber-100 border-t border-amber-100">
                  {bucket.orders.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small">
                      <Link
                        href={`/admin/orders/${row.id}`}
                        className="inline-flex items-center gap-1 font-semibold text-indigo-700 hover:underline"
                      >
                        {row.orderNo}
                        <Icon name="arrow-right" size={13} />
                      </Link>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageHours)}`}>
                        {ageLabel(row.ageHours)} ধরে আটকে
                      </span>
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
