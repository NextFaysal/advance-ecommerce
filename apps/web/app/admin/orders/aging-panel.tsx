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
import { pick, intlLocale, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

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
    chip: "bg-warning-soft text-warning-solid",
    header: "border-border/60",
  },
  confirmed_unpacked: {
    icon: "package",
    chip: "bg-warning-soft text-warning-solid ring-1 ring-inset ring-warning-solid/30",
    header: "border-border/60",
  },
  shipped_undelivered: {
    icon: "truck",
    chip: "bg-danger-soft text-danger",
    header: "border-border/60",
  },
  returning_stuck: {
    icon: "rotate-ccw",
    chip: "bg-danger-soft text-danger ring-1 ring-inset ring-danger/30",
    header: "border-border/60",
  },
};

/* Per-row age ramp: how long THIS order has been stuck. */
function ageChipClass(ageHours: number): string {
  if (ageHours >= 7 * 24) return "bg-danger-soft text-danger";
  if (ageHours >= 5 * 24) return "bg-warning-soft text-warning-solid ring-1 ring-inset ring-warning-solid/25";
  if (ageHours >= 48) return "bg-warning-soft text-warning-solid";
  return "bg-surface-2 text-text-muted";
}

function ageLabel(ageHours: number, locale: Locale): string {
  const s = pick(locale, ORDER_STRINGS);
  if (ageHours >= 48) return `${Math.floor(ageHours / 24)} ${s.ageDays}`;
  return `${Math.round(ageHours)} ${s.ageHours}`;
}

export function AgingPanel() {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
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
    <section className="mb-4 rounded-2xl border border-border/60 bg-warning-soft p-4 shadow-xs" aria-label={s.agingAria}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-0.5 text-small font-semibold text-warning-solid ring-1 ring-inset ring-warning-solid/30">
          <Icon name="alert" size={14} />
          {state.meta.totalStuck}{s.agingBadgeSuffix}
        </span>
        <p className="text-body font-medium text-text-main">
          {s.agingTitle}
        </p>
        <p className="text-caption text-text-muted">
          {s.agingHint}
        </p>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {buckets.map((bucket) => {
          const expanded = expandedKey === bucket.key;
          const ramp = BUCKET_RAMP[bucket.key] ?? BUCKET_RAMP.pending_old;
          return (
            <div key={bucket.key} className={`overflow-hidden rounded-xl border bg-surface ${ramp.header}`}>
              <button
                type="button"
                onClick={() => setExpandedKey(expanded ? null : bucket.key)}
                aria-expanded={expanded}
                className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <span className={`tnum inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-small font-semibold ${ramp.chip}`}>
                  <Icon name={ramp.icon} size={13} />
                  {bucket.count}
                </span>
                <span className="text-small font-medium text-text-main">{locale === "bn" ? bucket.labelBn : bucket.labelEn}</span>
                <span className="ml-auto inline-flex items-center gap-1 text-small font-medium text-text-muted">
                  {expanded ? s.hide : s.show}
                  <Icon name="chevron-down" size={14} className={expanded ? "rotate-180 transition" : "transition"} />
                </span>
              </button>
              {expanded && (
                <ul className="divide-y divide-border border-t border-border">
                  {bucket.orders.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small">
                      <Link
                        href={`/admin/orders/${row.id}`}
                        className="inline-flex items-center gap-1 rounded font-semibold text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      >
                        {row.orderNo}
                        <Icon name="arrow-right" size={13} />
                      </Link>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-caption font-semibold ${ageChipClass(row.ageHours)}`}>
                        {ageLabel(row.ageHours, locale)} {s.ageStuckSuffix}
                      </span>
                      <span>{s.totalWord} {formatBdt(row.totalPoisha)}</span>
                      <span className="ml-auto text-text-muted">{row.customerPhoneMasked}</span>
                    </li>
                  ))}
                  {bucket.count > bucket.orders.length && (
                    <li className="px-3 py-2 text-small text-text-muted">
                      {s.agingMore1} {bucket.count - bucket.orders.length}{s.agingMoreItems} {bucket.orders.length}{s.agingMore3}
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
