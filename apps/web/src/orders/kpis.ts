/**
 * Order KPI pack (doc 17, batch O8-2) — compact operational rates
 * computed from real rows, served by GET /api/v1/admin/orders/kpis.
 *
 * Every rate returns its numerator AND denominator next to the
 * percentage: a rate without its counts is a claim nobody can check.
 * ratePercent is null when the denominator is 0 (never NaN, never a
 * fabricated 0%).
 *
 * Definitions (range = Asia/Dhaka days [from, to], inclusive):
 *  - ordersCreated — Order rows created in range (deletedAt null).
 *  - confirmationRate — of the created cohort, the share that EVER
 *    reached CONFIRMED-or-beyond (an OrderStatusHistory row into any
 *    of CONFIRMED, PROCESSING, PACKED, SHIPPED, DELIVERED, FAILED,
 *    RETURN_REQUESTED, RETURNING, RETURNED, REFUNDED, EXCHANGED).
 *    "Ever" is deliberate: an order confirmed then cancelled was
 *    still confirmed work; cancelRate below counts it separately.
 *  - ordersDelivered — distinct orders with a DELIVERED history event
 *    in range (an event count, not a cohort).
 *  - deliverySuccessRate — ordersDelivered / distinct orders with a
 *    SHIPPED history event in range ("shipped-out").
 *  - averageOrderValuePoisha — Σ totalPoisha of the delivered-event
 *    orders / ordersDelivered.
 *  - returnRate — distinct orders with a Return in status COMPLETED
 *    whose updatedAt falls in range (COMPLETED is terminal, so
 *    updatedAt is the completion moment) / ordersDelivered.
 *  - advanceCollectionRate — of orders created in range with
 *    advanceRequiredPoisha > 0, the share with advanceSatisfiedAt set.
 *  - codCollectionRate — over COD orders delivered in range:
 *    Σ paidPoisha of their COD Payment rows (paidPoisha > 0, status
 *    not FAILED, deletedAt null — gross collected, before any refund)
 *    / Σ totalPoisha of those orders.
 *  - cancelRate — of the created cohort, the share with a CANCELLED
 *    history event (ever).
 */
import { prisma } from "@advance-ecommerce/db";
import { dhakaRangeUtc } from "@/lib/dhaka-date";
import type { OrderStatus } from "./types";

const CONFIRMED_OR_BEYOND: OrderStatus[] = [
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
  "SHIPPED",
  "DELIVERED",
  "FAILED",
  "RETURN_REQUESTED",
  "RETURNING",
  "RETURNED",
  "REFUNDED",
  "EXCHANGED",
];

export interface KpiRate {
  numerator: number;
  denominator: number;
  /** Percentage with one decimal, or null when denominator is 0. */
  ratePercent: number | null;
}

function rate(numerator: number, denominator: number): KpiRate {
  return {
    numerator,
    denominator,
    ratePercent:
      denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null,
  };
}

export interface OrderKpis {
  range: { from: string; to: string };
  ordersCreated: number;
  ordersDelivered: number;
  confirmationRate: KpiRate;
  deliverySuccessRate: KpiRate;
  averageOrderValue: { totalPoisha: number; orders: number; averagePoisha: number | null };
  returnRate: KpiRate;
  advanceCollectionRate: KpiRate;
  codCollectionRate: KpiRate & { collectedPoisha: number; duePoisha: number };
  cancelRate: KpiRate;
}

async function distinctOrderIds(
  rows: Promise<Array<{ orderId: string }>>,
): Promise<string[]> {
  const list = await rows;
  return [...new Set(list.map((r) => r.orderId))];
}

export async function getOrderKpis(fromYmd: string, toYmd: string): Promise<OrderKpis> {
  const { startUtc, endUtc } = dhakaRangeUtc(fromYmd, toYmd);
  const inRange = { gte: startUtc, lte: endUtc };

  const created = await prisma.order.findMany({
    where: { createdAt: inRange, deletedAt: null },
    select: {
      id: true,
      totalPoisha: true,
      paymentMethod: true,
      advanceRequiredPoisha: true,
      advanceSatisfiedAt: true,
    },
  });
  const createdIds = created.map((o) => o.id);

  const [confirmedIds, cancelledIds, deliveredIds, shippedIds, returnedOrderIds] =
    await Promise.all([
      createdIds.length
        ? distinctOrderIds(
            prisma.orderStatusHistory.findMany({
              where: { orderId: { in: createdIds }, to: { in: CONFIRMED_OR_BEYOND } },
              select: { orderId: true },
              distinct: ["orderId"],
            }),
          )
        : Promise.resolve([] as string[]),
      createdIds.length
        ? distinctOrderIds(
            prisma.orderStatusHistory.findMany({
              where: { orderId: { in: createdIds }, to: "CANCELLED" },
              select: { orderId: true },
              distinct: ["orderId"],
            }),
          )
        : Promise.resolve([] as string[]),
      distinctOrderIds(
        prisma.orderStatusHistory.findMany({
          where: { to: "DELIVERED", createdAt: inRange },
          select: { orderId: true },
          distinct: ["orderId"],
        }),
      ),
      distinctOrderIds(
        prisma.orderStatusHistory.findMany({
          where: { to: "SHIPPED", createdAt: inRange },
          select: { orderId: true },
          distinct: ["orderId"],
        }),
      ),
      distinctOrderIds(
        prisma.return.findMany({
          where: { status: "COMPLETED", updatedAt: inRange, deletedAt: null },
          select: { orderId: true },
          distinct: ["orderId"],
        }),
      ),
    ]);

  const deliveredOrders = deliveredIds.length
    ? await prisma.order.findMany({
        where: { id: { in: deliveredIds } },
        select: { id: true, totalPoisha: true, paymentMethod: true },
      })
    : [];
  const deliveredTotalPoisha = deliveredOrders.reduce((s, o) => s + o.totalPoisha, 0);

  const codDelivered = deliveredOrders.filter((o) => o.paymentMethod === "COD");
  const codDuePoisha = codDelivered.reduce((s, o) => s + o.totalPoisha, 0);
  let codCollectedPoisha = 0;
  if (codDelivered.length > 0) {
    const agg = await prisma.payment.aggregate({
      where: {
        orderId: { in: codDelivered.map((o) => o.id) },
        method: "COD",
        paidPoisha: { gt: 0 },
        status: { not: "FAILED" },
        deletedAt: null,
      },
      _sum: { paidPoisha: true },
    });
    codCollectedPoisha = agg._sum.paidPoisha ?? 0;
  }

  const advanceRequired = created.filter((o) => o.advanceRequiredPoisha > 0);
  const advanceSatisfied = advanceRequired.filter((o) => o.advanceSatisfiedAt !== null);

  return {
    range: { from: fromYmd, to: toYmd },
    ordersCreated: created.length,
    ordersDelivered: deliveredIds.length,
    confirmationRate: rate(confirmedIds.length, created.length),
    deliverySuccessRate: rate(deliveredIds.length, shippedIds.length),
    averageOrderValue: {
      totalPoisha: deliveredTotalPoisha,
      orders: deliveredIds.length,
      averagePoisha:
        deliveredIds.length > 0
          ? Math.round(deliveredTotalPoisha / deliveredIds.length)
          : null,
    },
    returnRate: rate(returnedOrderIds.length, deliveredIds.length),
    advanceCollectionRate: rate(advanceSatisfied.length, advanceRequired.length),
    codCollectionRate: {
      ...rate(codCollectedPoisha, codDuePoisha),
      collectedPoisha: codCollectedPoisha,
      duePoisha: codDuePoisha,
    },
    cancelRate: rate(cancelledIds.length, created.length),
  };
}
