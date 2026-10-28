// Reports DB row source — builds SalesRow[] from real Prisma tables.
//
// The reports service (src/reports/service.ts) is a pure aggregator over
// SalesRow[]; this module is the DB side of that contract. One row per
// order ITEM, built only from stored poisha fields:
//   revenuePoisha = lineTotalPoisha(OrderItem.unitPricePoisha, quantity) — wave 59 half-up line rule
//   costPoisha    = ProductVariant.costPoisha * quantity (a variant with
//                   no recorded cost counts as 0 — the cost is unknown,
//                   never invented; see the meta note on report routes)
// Order-level amounts (shipping, refunds) are attributed to the FIRST
// item row of the order only, so aggregateSales never double-counts
// them for multi-item orders. Orders with no items produce no rows
// (they carry no sales lines; dashboard order counts come from direct
// COUNT queries, not from these rows).
// Dates: an order belongs to the Asia/Dhaka calendar date of its
// createdAt — range bounds are converted Dhaka-midnight -> UTC.
import { prisma } from "@advance-ecommerce/db";
import type { DateRange, SalesRow } from "./types";
import { lineTotalPoisha, qtyNumber } from "../lib/quantity";
import { previousRange } from "./service";

const DHAKA_TZ = "Asia/Dhaka";
/** BD is UTC+6 year-round (no DST), so offset math on date strings is exact. */
const DHAKA_OFFSET = "+06:00";

const dhakaDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: DHAKA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD of an instant on the Asia/Dhaka calendar. */
export function dhakaDateOf(instant: Date): string {
  return dhakaDateFmt.format(instant);
}

/** Today on the Asia/Dhaka calendar, YYYY-MM-DD. */
export function todayInDhaka(): string {
  return dhakaDateOf(new Date());
}

/** The Dhaka date `days` days before today (Dhaka), YYYY-MM-DD. */
export function daysAgoInDhaka(days: number): string {
  const [y, m, d] = todayInDhaka().split("-").map(Number);
  const base = Date.UTC(y as number, (m as number) - 1, d as number);
  return new Date(base - days * 86400000).toISOString().slice(0, 10);
}

/** UTC instant bounds covering the Dhaka calendar dates [from, to] inclusive. */
export function dhakaRangeUtc(range: DateRange): { gte: Date; lte: Date } {
  return {
    gte: new Date(`${range.from}T00:00:00.000${DHAKA_OFFSET}`),
    lte: new Date(`${range.to}T23:59:59.999${DHAKA_OFFSET}`),
  };
}

/** Widen a range to also cover its comparison (previous) period, for
 *  callers that pass the rows to aggregateSales(range, compare=true). */
export function withComparisonWindow(range: DateRange): DateRange {
  return { from: previousRange(range).from, to: range.to };
}

const REFUND_EXCLUDED_STATUSES = new Set(["REJECTED", "FAILED", "CANCELLED"]);

/** Sales rows for every order created within the Dhaka dates [from, to]. */
export async function fetchSalesRows(range: DateRange): Promise<SalesRow[]> {
  const { gte, lte } = dhakaRangeUtc(range);
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte, lte } },
    orderBy: { createdAt: "asc" },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { variant: { select: { productId: true, costPoisha: true } } },
      },
      shipments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { provider: true },
      },
    },
  });
  if (orders.length === 0) return [];

  // Refunds hang off Payment, not Order, in the schema — fetch by orderId
  // in one query and group here.
  const refunds = await prisma.refund.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    select: { orderId: true, amountPoisha: true, status: true },
  });
  const refundByOrder = new Map<string, number>();
  for (const r of refunds) {
    if (REFUND_EXCLUDED_STATUSES.has(r.status.toUpperCase())) continue;
    refundByOrder.set(r.orderId, (refundByOrder.get(r.orderId) ?? 0) + r.amountPoisha);
  }

  const rows: SalesRow[] = [];
  for (const order of orders) {
    const date = dhakaDateOf(order.createdAt);
    const courier = order.courier ?? order.shipments[0]?.provider ?? null;
    const refundPoisha = refundByOrder.get(order.id) ?? 0;
    order.items.forEach((item, idx) => {
      rows.push({
        orderId: order.id,
        date,
        customerId: order.customerId,
        district: order.district,
        courier,
        productId: item.variant.productId,
        quantity: qtyNumber(item.quantity),
        revenuePoisha: lineTotalPoisha(item.unitPricePoisha, item.quantity),
        costPoisha: lineTotalPoisha(item.variant.costPoisha ?? 0, item.quantity),
        shippingPoisha: idx === 0 ? order.shippingPoisha : 0,
        refundPoisha: idx === 0 ? refundPoisha : 0,
        status: order.status as SalesRow["status"],
      });
    });
  }
  return rows;
}

export interface OrderActivityRow {
  customerId: string;
  orderId: string;
  /** YYYY-MM-DD on the Asia/Dhaka calendar — same derivation as SalesRow.date. */
  date: string;
  status: string;
}

/**
 * Cohort-activity input (perf wave A2): one lightweight row per ORDER
 * (id, customer, Dhaka date, status) instead of fetchSalesRows'
 * item-level scan with items/variant/shipment includes plus the
 * refunds query. Provably equivalent input for buildCustomerActivity
 * (src/analytics/cohort.ts): that function skips CANCELLED orders and
 * dedupes the remaining item rows by orderId, so per order it
 * consumes exactly (customerId, orderId, dhakaDateOf(createdAt),
 * status) — and only for orders that HAVE items, since
 * fetchSalesRows emits no rows for item-less orders; the
 * `items: { some: {} }` filter mirrors that exactly.
 */
export async function fetchOrderActivityRows(range: DateRange): Promise<OrderActivityRow[]> {
  const { gte, lte } = dhakaRangeUtc(range);
  const orders = await prisma.order.findMany({
    where: { deletedAt: null, createdAt: { gte, lte }, items: { some: {} } },
    orderBy: { createdAt: "asc" },
    select: { id: true, customerId: true, createdAt: true, status: true },
  });
  return orders.map((o) => ({
    customerId: o.customerId,
    orderId: o.id,
    date: dhakaDateOf(o.createdAt),
    status: o.status,
  }));
}
