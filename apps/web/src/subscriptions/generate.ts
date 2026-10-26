/**
 * Subscription generation sweep (ADV-18 remainder) — the worker-side
 * half of subscriptions. `processDueSubscriptions(now)` turns every
 * due ACTIVE subscription into a REAL order through the shared
 * createManualOrder seam (the same pipeline staff phone orders use:
 * catalog price snapshots, stock checks, fraud scoring, shipping
 * engine, audit), with source "subscription" and the configured
 * Subscribe & Save discount (Settings subscriptions.discount_bps,
 * computed server-side inside createManualOrder from the bps).
 *
 * IDEMPOTENCY: each cycle's order carries a deterministic
 * idempotency key — deterministicUuid("subscription:<id>:<scheduled
 * nextRunAt>"). If the sweep crashes after creating an order but
 * before advancing the row, the next sweep replays the SAME key and
 * createManualOrder returns the stored order instead of a duplicate;
 * the row then advances. A replay therefore never double-creates.
 *
 * CYCLE POLICY: a successful OR failed cycle advances nextRunAt past
 * `now` (missed cycles are skipped, never back-filled into an order
 * storm after worker downtime). Failures are recorded on the row
 * (lastError) and surface in the admin subscription list — a failed
 * cycle is visible, not silent.
 *
 * HONEST STATE: this function runs ONLY in the worker process. No
 * worker host exists yet (VPS lands after development completes), so
 * in production today subscriptions accumulate and NO orders are
 * generated — the admin list and the account page both say so.
 * Nothing in the web process calls this function.
 *
 * WIRING (worker assembly — parent completes in worker-deps.ts):
 *   1. HandlerDeps.subscriptionRunner:
 *        subscriptionRunner: async () => {
 *          const { processDueSubscriptions } = await import("@/subscriptions/generate");
 *          const out = await processDueSubscriptions(new Date());
 *          return { processedRef: `due:${out.due} created:${out.created} failed:${out.failed}`, detail: out.ran ? "sweep complete" : out.reason };
 *        },
 *      (handlers.ts already routes QUEUE_NAMES.subscriptions to this
 *      dep and skips honestly when it is absent.)
 *   2. A producer that enqueues { sweepKey } on QUEUE_NAMES.subscriptions
 *      on a schedule (BullMQ repeatable job, e.g. every 15 minutes,
 *      sweepKey = the tick's ISO timestamp) from the worker
 *      entrypoint (scripts/worker.ts) — the queue has no web-side
 *      producer by design.
 */
import { prisma } from "@advance-ecommerce/db";
import { createManualOrder, type ManualOrderActor } from "@/orders/manual-create";
import { getVariantSnapshots } from "@/orders/repository";
import { deterministicUuid } from "@/importers/orders-service";
import { zoneForDistrict } from "@/checkout/shipping-core";
import { subscriptionsEnabled } from "./flags";
import { addInterval, loadSubscriptionDiscountBps } from "./service";
import { qtyNumber } from "../lib/quantity";

const SWEEP_BATCH = 100;

/** The generator's audit identity: a system actor (null id — the
 *  audit row records the channel via the order's source + note). */
const SYSTEM_ACTOR: ManualOrderActor = { id: null, permissions: [] };

export interface SubscriptionSweepResult {
  ran: boolean;
  reason?: string;
  due: number;
  created: number;
  failed: number;
  orderIds: string[];
}

export async function processDueSubscriptions(
  now: Date = new Date(),
): Promise<SubscriptionSweepResult> {
  if (!subscriptionsEnabled()) {
    return {
      ran: false,
      reason: "module.subscriptions is OFF",
      due: 0,
      created: 0,
      failed: 0,
      orderIds: [],
    };
  }

  const due = await prisma.subscription.findMany({
    where: { status: "ACTIVE", nextRunAt: { lte: now } },
    orderBy: { nextRunAt: "asc" },
    take: SWEEP_BATCH,
  });
  const discountBps = await loadSubscriptionDiscountBps();

  let created = 0;
  let failed = 0;
  const orderIds: string[] = [];

  for (const sub of due) {
    // Advance from the SCHEDULED instant, stepping over any missed
    // cycles, until the next run is in the future.
    let nextRunAt = sub.nextRunAt;
    do {
      nextRunAt = addInterval(nextRunAt, sub.interval);
    } while (nextRunAt.getTime() <= now.getTime());

    try {
      const snapshots = await getVariantSnapshots([sub.variantId]);
      const snapshot = snapshots.get(sub.variantId);
      if (snapshot === undefined) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            lastError: "VARIANT_NOT_FOUND: the subscribed variant no longer exists; cycle skipped.",
            nextRunAt,
          },
        });
        failed += 1;
        continue;
      }

      const result = await createManualOrder(
        {
          customerId: sub.customerId,
          customerName: sub.customerName,
          phone: sub.customerPhone,
          address: {
            division: sub.division,
            district: sub.district,
            upazila: sub.upazila,
            union: sub.union ?? undefined,
            addressLine: sub.addressLine,
          },
          items: [
            {
              variantId: sub.variantId,
              quantity: qtyNumber(sub.quantity),
              unitPricePoisha: snapshot.unitPricePoisha,
            },
          ],
          paymentMethod: "cod",
          shippingMethod: zoneForDistrict(sub.district),
          source: "subscription",
          internalNote: `সাবস্ক্রিপশন অর্ডার — সাবস্ক্রিপশন আইডি: ${sub.id} [subscription:${sub.id}]`,
          idempotencyKey: deterministicUuid(`subscription:${sub.id}:${sub.nextRunAt.toISOString()}`),
          subscriptionDiscountBps: discountBps,
        },
        SYSTEM_ACTOR,
      );

      if (result.ok) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            lastRunAt: now,
            lastOrderId: result.orderId,
            lastError: null,
            runCount: { increment: 1 },
            nextRunAt,
          },
        });
        created += 1;
        orderIds.push(result.orderId);
      } else {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            lastError: `${result.code}: ${result.message}`.slice(0, 500),
            nextRunAt,
          },
        });
        failed += 1;
      }
    } catch (error) {
      // One bad row must never kill the sweep for the rest.
      await prisma.subscription
        .update({
          where: { id: sub.id },
          data: {
            lastError: `UNEXPECTED: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 500),
            nextRunAt,
          },
        })
        .catch(() => undefined);
      failed += 1;
    }
  }

  return { ran: true, due: due.length, created, failed, orderIds };
}
