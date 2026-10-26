/**
 * Staff targets + progress (ADV-27 remainder, doc 22).
 *
 * Targets live in a Setting doc `team.targets.<yyyy-mm>` =
 * [{ userId, ordersTarget?, revenueTargetPoisha? }], set by managers
 * (staff.manage — the same permission that invites/suspends staff).
 *
 * ATTRIBUTION RULE (also printed on /admin/team — progress is only
 * honest if the rule is visible): Order has NO per-staff handler
 * field, so "handled" is derived from OrderStatusHistory, the one
 * place a staff actor is recorded (changedById):
 *   handledOrders     = distinct orders this staff member transitioned
 *                       INTO CONFIRMED during the month (Dhaka bounds)
 *   deliveredOrders   = distinct orders they transitioned INTO
 *                       DELIVERED during the month
 *   deliveredRevenue  = Σ Order.totalPoisha of those delivered orders
 * A transition recorded without an actor (changedById null — e.g. a
 * courier webhook or a system path) counts for NOBODY. It is never
 * guessed or spread across the team.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { dhakaRangeUtc } from "@/lib/dhaka-date";
import { assertStaffIds, monthLastDay, readDoc, writeDoc } from "./docs";

export const targetEntrySchema = z.object({
  userId: z.string().min(1),
  ordersTarget: z.number().int().min(0).max(1_000_000).optional(),
  revenueTargetPoisha: z.number().int().min(0).max(100_000_000_000).optional(),
});

export type TargetEntry = z.infer<typeof targetEntrySchema>;

const targetsDocSchema = z.object({
  version: z.literal(1),
  targets: z.array(targetEntrySchema),
});

export function targetsKey(month: string): string {
  return `team.targets.${month}`;
}

export async function getTargets(month: string): Promise<TargetEntry[]> {
  const doc = await readDoc(targetsKey(month), targetsDocSchema, {
    version: 1 as const,
    targets: [],
  });
  return doc.targets;
}

/** Replace-all write: the /admin/team form always sends the full
 *  month list, so the doc becomes exactly what the manager saved. */
export async function setTargets(
  month: string,
  targets: TargetEntry[],
  actorId: string,
): Promise<TargetEntry[]> {
  await assertStaffIds(targets.map((t) => t.userId));
  const byUser = new Map<string, TargetEntry>();
  for (const t of targets) byUser.set(t.userId, t);
  const list = [...byUser.values()];
  await writeDoc(targetsKey(month), { version: 1, targets: list }, actorId);
  return list;
}

export interface StaffProgress {
  userId: string;
  handledOrders: number;
  deliveredOrders: number;
  deliveredRevenuePoisha: number;
}

export async function computeProgress(month: string, userIds: string[]): Promise<StaffProgress[]> {
  const progress = new Map<string, StaffProgress>();
  for (const userId of userIds) {
    progress.set(userId, {
      userId,
      handledOrders: 0,
      deliveredOrders: 0,
      deliveredRevenuePoisha: 0,
    });
  }
  if (userIds.length === 0) return [];

  const { startUtc, endUtc } = dhakaRangeUtc(`${month}-01`, monthLastDay(month));
  const history = await prisma.orderStatusHistory.findMany({
    where: {
      changedById: { in: userIds },
      to: { in: ["CONFIRMED", "DELIVERED"] },
      createdAt: { gte: startUtc, lte: endUtc },
    },
    select: { orderId: true, changedById: true, to: true },
  });

  const confirmedByUser = new Map<string, Set<string>>();
  const deliveredByUser = new Map<string, Set<string>>();
  const deliveredOrderIds = new Set<string>();
  for (const row of history) {
    const userId = row.changedById as string;
    if (row.to === "CONFIRMED") {
      (confirmedByUser.get(userId) ?? confirmedByUser.set(userId, new Set()).get(userId)!).add(row.orderId);
    } else {
      (deliveredByUser.get(userId) ?? deliveredByUser.set(userId, new Set()).get(userId)!).add(row.orderId);
      deliveredOrderIds.add(row.orderId);
    }
  }

  const totals = new Map<string, number>();
  if (deliveredOrderIds.size > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: [...deliveredOrderIds] }, deletedAt: null },
      select: { id: true, totalPoisha: true },
    });
    for (const o of orders) totals.set(o.id, o.totalPoisha);
  }

  for (const [userId, p] of progress) {
    p.handledOrders = confirmedByUser.get(userId)?.size ?? 0;
    const delivered = deliveredByUser.get(userId) ?? new Set<string>();
    p.deliveredOrders = delivered.size;
    p.deliveredRevenuePoisha = [...delivered].reduce((s, id) => s + (totals.get(id) ?? 0), 0);
  }
  return [...progress.values()];
}
