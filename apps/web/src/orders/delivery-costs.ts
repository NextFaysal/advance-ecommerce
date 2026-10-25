/**
 * Failed-delivery cost ledger (doc 17, batch O8-2) — a READ MODEL
 * over existing rows, served by GET /api/v1/admin/orders/delivery-costs.
 * No new tables: a failed or returned delivery burns the courier
 * charge that was actually booked, and until now nothing totalled it.
 *
 * Cohort: orders that REACHED a failed-delivery or returned state in
 * the range — an OrderStatusHistory event into FAILED or RETURNED in
 * range; plus, as a legacy fallback, orders whose CURRENT status is
 * FAILED / RETURNED with updatedAt in range but no such history row
 * (rows that predate funnel history).
 *
 * Costs per order:
 *  - outboundChargePoisha — Σ Shipment.chargePoisha over the order's
 *    bookings (deletedAt null). This is the charge actually booked,
 *    summed across split parcels.
 *  - returnChargePoisha — the return-leg charge. NO booking record
 *    carries one: Shipment has no return-charge field, and the
 *    returnChargePoisha in src/bd/courier-reconciliation.ts belongs
 *    to imported courier-invoice rows, not to bookings. So this is
 *    always null with returnCostRecorded: false — never invented,
 *    never silently treated as 0. totalKnownCostPoisha is therefore
 *    the outbound charge alone, and the summary counts how many
 *    orders carry an unknown return cost.
 */
import { prisma } from "@advance-ecommerce/db";
import { dhakaRangeUtc } from "@/lib/dhaka-date";

export interface DeliveryCostRow {
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

export interface DeliveryCosts {
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

const ROW_CAP = 200;

export async function getDeliveryCosts(
  fromYmd: string,
  toYmd: string,
): Promise<DeliveryCosts> {
  const { startUtc, endUtc } = dhakaRangeUtc(fromYmd, toYmd);
  const inRange = { gte: startUtc, lte: endUtc };

  const [historyRows, currentRows] = await Promise.all([
    prisma.orderStatusHistory.findMany({
      where: { to: { in: ["FAILED", "RETURNED"] }, createdAt: inRange },
      select: { orderId: true, to: true },
    }),
    prisma.order.findMany({
      where: { status: { in: ["FAILED", "RETURNED"] }, updatedAt: inRange },
      select: { id: true, status: true },
    }),
  ]);

  const flags = new Map<string, { failed: boolean; returned: boolean }>();
  const mark = (orderId: string, to: "FAILED" | "RETURNED") => {
    const entry = flags.get(orderId) ?? { failed: false, returned: false };
    if (to === "FAILED") entry.failed = true;
    else entry.returned = true;
    flags.set(orderId, entry);
  };
  for (const row of historyRows) mark(row.orderId, row.to as "FAILED" | "RETURNED");
  for (const row of currentRows) {
    if (!flags.has(row.id)) mark(row.id, row.status as "FAILED" | "RETURNED");
  }

  const orderIds = [...flags.keys()];
  const empty: DeliveryCosts = {
    range: { from: fromYmd, to: toYmd },
    rows: [],
    summary: {
      failedCount: 0,
      returnedCount: 0,
      knownCostPoisha: 0,
      ordersWithUnknownReturnCost: 0,
    },
    truncated: false,
  };
  if (orderIds.length === 0) return empty;

  const [orders, chargeGroups] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: orderIds } },
      select: { id: true, orderNo: true, status: true },
    }),
    prisma.shipment.groupBy({
      by: ["orderId"],
      where: { orderId: { in: orderIds }, deletedAt: null },
      _sum: { chargePoisha: true },
    }),
  ]);
  const chargeByOrder = new Map(
    chargeGroups.map((g) => [g.orderId, g._sum.chargePoisha ?? 0]),
  );

  const allRows: DeliveryCostRow[] = orders.map((order) => {
    const entry = flags.get(order.id) ?? { failed: false, returned: false };
    const outboundChargePoisha = chargeByOrder.get(order.id) ?? 0;
    return {
      orderId: order.id,
      orderNo: order.orderNo,
      status: order.status,
      reachedFailed: entry.failed,
      reachedReturned: entry.returned,
      outboundChargePoisha,
      returnChargePoisha: null,
      returnCostRecorded: false,
      totalKnownCostPoisha: outboundChargePoisha,
    };
  });
  allRows.sort((a, b) => b.totalKnownCostPoisha - a.totalKnownCostPoisha);

  return {
    range: { from: fromYmd, to: toYmd },
    rows: allRows.slice(0, ROW_CAP),
    summary: {
      failedCount: allRows.filter((r) => r.reachedFailed).length,
      returnedCount: allRows.filter((r) => r.reachedReturned).length,
      knownCostPoisha: allRows.reduce((s, r) => s + r.totalKnownCostPoisha, 0),
      ordersWithUnknownReturnCost: allRows.filter((r) => !r.returnCostRecorded).length,
    },
    truncated: allRows.length > ROW_CAP,
  };
}
