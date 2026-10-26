// Pure shaping helpers for the orders list v3 (doc 19, batch OD1).
// No React, no fetch — everything here is a function of the list-v2
// payload shapes (meta.counts / Order rows / the detail GET payload),
// so the tsx smoke can pin the behaviour without a browser. The list
// page and the slide-over preview both consume these; nothing here
// changes what the API returns or how it is counted.
import { addQty, lineTotalPoisha } from "../../../src/lib/quantity";
import type {
  Order,
  OrderStatus,
  OrderStatusHistoryEntry,
} from "../../../src/orders/types";

/** The 13 order statuses in funnel (lifecycle) order — the same order
 *  the chips have always rendered in, now also the kanban column order. */
export const ORDER_FUNNEL_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "RETURN_REQUESTED",
  "RETURNING",
  "RETURNED",
  "CANCELLED",
  "REFUNDED",
  "EXCHANGED",
];

export interface FunnelChip {
  status: "ALL" | OrderStatus;
  /** meta.counts value; undefined until the first list response lands. */
  count: number | undefined;
  /** Explicit zeros render dimmed — the status exists in the funnel,
   *  it just has nothing in it under the current search. */
  dimmed: boolean;
}

/** Build the funnel strip from meta.counts (SQL aggregates over the
 *  set filtered by everything EXCEPT status — see list-v2). Counts are
 *  passed through untouched; this only orders and dims them. */
export function funnelChips(
  counts: Record<string, number> | null,
): FunnelChip[] {
  return [
    { status: "ALL", count: counts?.ALL, dimmed: false },
    ...ORDER_FUNNEL_STATUSES.map((status) => ({
      status,
      count: counts?.[status],
      dimmed: counts?.[status] === 0,
    })),
  ];
}

/** Σ item snapshot lines — the subtotal the print centre reconciles
 *  against (doc 18 F1 split lines). */
export function subtotalPoishaOf(order: Pick<Order, "items">): number {
  return order.items.reduce(
    (sum, item) => sum + lineTotalPoisha(item.unitPricePoisha, item.quantity),
    0,
  );
}

/** Total units across all lines (Σ quantity, not line count). */
export function itemUnitCount(order: Pick<Order, "items">): number {
  return order.items.reduce((sum, item) => addQty(sum, item.quantity), 0);
}

/** One-line item summary for cards: first product + unit count, e.g.
 *  "কটন টি-শার্ট + আরও ২টি · মোট ৪টি আইটেম". Empty order → "—". */
export function itemsSummaryLabel(order: Pick<Order, "items">): string {
  if (order.items.length === 0) return "—";
  const bn = (n: number) => n.toLocaleString("bn-BD");
  const first = order.items[0].productName;
  const units = itemUnitCount(order);
  const more =
    order.items.length > 1 ? ` + আরও ${bn(order.items.length - 1)}টি` : "";
  return `${first}${more} · মোট ${bn(units)}টি আইটেম`;
}

/** Relative age in Bangla, mirroring the drafts strip's ageText but
 *  with `now` injected so the smoke can pin it deterministically. */
export function orderAgeLabel(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((nowMs - then) / 60000));
  const bn = (n: number) => n.toLocaleString("bn-BD");
  if (minutes < 1) return "এখনই";
  if (minutes < 60) return `${bn(minutes)} মিনিট আগে`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${bn(hours)} ঘণ্টা আগে`;
  return `${bn(Math.floor(hours / 24))} দিন আগে`;
}

/** The newest `n` history entries, newest first. Returns a copy —
 *  the payload's array is never mutated. */
export function timelineHead(
  history: readonly OrderStatusHistoryEntry[],
  n = 4,
): OrderStatusHistoryEntry[] {
  return history.slice(-n).reverse();
}

/** The detail payload as the preview consumes it: the enriched Order
 *  view plus the advance read model the GET route attaches. */
export type PreviewOrder = Order & {
  advance?: { paidPoisha: number; requiredPoisha: number } | null;
};

/** Props for OD0's MoneyBreakdown, shaped from the detail payload.
 *  paidPoisha comes from the advance read model — the same source the
 *  print centre uses (advance.paidPoisha); absent advance → 0.
 *  discount/shipping pass through untouched (undefined on payloads
 *  that predate the doc-18 split; MoneyBreakdown renders the net
 *  fallback for those, exactly like print). */
export function previewMoneyProps(order: PreviewOrder): {
  subtotalPoisha: number;
  discountPoisha?: number;
  shippingPoisha?: number;
  totalPoisha: number;
  paidPoisha: number;
} {
  return {
    subtotalPoisha: subtotalPoishaOf(order),
    discountPoisha: order.discountPoisha,
    shippingPoisha: order.shippingPoisha,
    totalPoisha: order.totalPoisha,
    paidPoisha: order.advance?.paidPoisha ?? 0,
  };
}
