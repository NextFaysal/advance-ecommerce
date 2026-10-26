/**
 * Stale-unpaid order auto-cancel sweep (ADV-1 remainder, doc 22) —
 * the worker-side cleanup for orders that were placed, never paid
 * and never confirmed. `processStaleUnpaidOrders(now)` cancels every
 * eligible order through the ONE status funnel
 * (applyOrderTransition), so a sweep cancellation is
 * indistinguishable from a staff cancellation downstream: the funnel
 * itself releases the stock reservations
 * (releaseOrderStockReservations), restores bundle components and
 * coupon usage, and runs the reversal hooks. This module never
 * touches stock, coupons or gift cards directly.
 *
 * ELIGIBILITY (all must hold; anything else is SKIPPED, never
 * cancelled):
 *   - status is PENDING and the row is not soft-deleted;
 *   - createdAt is at or before now − threshold (Settings
 *     orders.auto_cancel.hours, default 72);
 *   - paymentStatus is still UNPAID and advanceSatisfiedAt is NULL
 *     (no advance has been satisfied);
 *   - NO money fact exists for the order, re-checked fresh per order
 *     immediately before its transition (orderHasReceivedMoney):
 *       · Σ Payment.paidPoisha (non-deleted rows) > 0, or
 *       · a PaymentAttempt with status PAID (a gateway-verified
 *         attempt), or
 *       · a ManualTrxSubmission with status APPROVED (staff-verified
 *         money — linked Rocket submissions carry their money on the
 *         Payment row and are caught by the first check too), or
 *       · a GiftCardTransaction REDEEM row for the order (gift
 *         balance was actually taken at create; the order is paid
 *         in substance even if only partially — staff may still
 *         cancel manually, which restores the balance).
 *   - heldAt is NULL: an order a staff member deliberately put on
 *     operational HOLD is being handled by a human; the sweep leaves
 *     it alone.
 * An order with a PAID advance or a verified payment attempt can
 * therefore NEVER be auto-cancelled — those are exactly the money
 * facts above. The residual race (money landing in the milliseconds
 * between the fresh check and the funnel's commit) is bounded by the
 * funnel re-loading the order and re-validating its status; a
 * payment that lands after cancellation is a refund case for staff,
 * same as a customer paying after a manual cancel.
 *
 * GATES: none apply. applyOrderTransition gates only CONFIRMED
 * (advance / ADV-27 approval / pharmacy Rx) and DELIVERED (pickup
 * OTP); its header states "Cancellation is never gated", and a
 * PENDING → CANCELLED move is legal in the state machine. The sweep
 * passes no advanceOverride and needs none.
 *
 * OPT-IN: the sweep is DISABLED unless Settings
 * orders.auto_cancel.enabled is exactly "true" — an unconfigured
 * shop never auto-cancels anything. Both keys are read through
 * getSetting on every run (30s memo), so a settings change takes
 * effect without a worker restart beyond that memo window.
 *
 * VISIBILITY: every invocation — including a disabled one — records
 * its outcome as a JSON doc in the Setting table under
 * `orders.auto_cancel_last_run` (the pick-lists doc pattern: direct
 * upsert, no setSetting, no audit row). An admin surface can thus
 * distinguish "worker not running" (doc absent/stale) from "running
 * but disabled" (fresh doc, enabled:false) from a real sweep
 * (counts + cancelled order numbers). The write is best-effort: a
 * bookkeeping failure never fails the sweep.
 *
 * HONEST STATE: this function runs ONLY in the worker process. No
 * worker host exists yet (VPS lands after development completes),
 * so in production today nothing is auto-cancelled — orders simply
 * stay PENDING until staff act, exactly as before this module.
 * Nothing in the web process calls this function.
 *
 * WIRING (worker assembly — parent completes; mirrors the
 * subscriptions sweep end to end):
 *   1. queues.ts — add to QUEUE_NAMES:
 *        orderAutoCancel: "order-auto-cancel",
 *      and the payload type next to SubscriptionJob:
 *        export interface OrderAutoCancelJob { sweepKey: string; }
 *      plus a catalogue comment row in the queues.ts header table.
 *   2. handlers.ts — add to HandlerDeps:
 *        orderAutoCancelRunner?: (
 *          job: OrderAutoCancelJob,
 *        ) => Promise<{ processedRef: string; detail?: string }>;
 *      and a handler cloned from `subscriptions` (runIdempotent keyed
 *      on envelope.payload.sweepKey; honest "skipped" when the dep is
 *      absent), registered as [QUEUE_NAMES.orderAutoCancel].
 *   3. worker-deps.ts — next to subscriptionRunner:
 *        orderAutoCancelRunner: async () => {
 *          const { processStaleUnpaidOrders } = await import("../orders/auto-cancel");
 *          const out = await processStaleUnpaidOrders(new Date());
 *          return {
 *            processedRef: `scanned:${out.scanned} cancelled:${out.cancelled} skipped:${out.skipped} failed:${out.failed}`,
 *            detail: out.ran ? "sweep complete" : out.reason,
 *          };
 *        },
 *   4. A producer that enqueues { sweepKey } on
 *      QUEUE_NAMES.orderAutoCancel on a schedule (BullMQ repeatable
 *      job, e.g. every 15 minutes, sweepKey = the tick's ISO
 *      timestamp) from the worker entrypoint (scripts/worker.ts) —
 *      the same outstanding scheduler step the subscriptions queue
 *      already waits on; neither queue has a web-side producer by
 *      design.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { applyOrderTransition } from "./repository";

export const AUTO_CANCEL_ENABLED_KEY = "orders.auto_cancel.enabled";
export const AUTO_CANCEL_HOURS_KEY = "orders.auto_cancel.hours";
export const AUTO_CANCEL_LAST_RUN_KEY = "orders.auto_cancel_last_run";

export const AUTO_CANCEL_DEFAULT_HOURS = 72;
/** Sanity ceiling for the configured threshold (90 days). */
const AUTO_CANCEL_MAX_HOURS = 24 * 90;
const SWEEP_BATCH = 100;
const FAILURE_DETAIL_CAP = 20;

/** changedBy label for the funnel: free-text actors persist as a
 *  NULL changedById on the history row (resolveUserId finds no such
 *  user) — the same convention as the courier sync's SYSTEM_ACTOR. */
const SYSTEM_ACTOR = "system";

export interface AutoCancelFailure {
  orderId: string;
  orderNo: string;
  error: string;
}

export interface AutoCancelSweepResult {
  ran: boolean;
  reason?: string;
  enabled: boolean;
  thresholdHours: number;
  /** Candidates examined (PENDING + older than the threshold). */
  scanned: number;
  cancelled: number;
  /** Candidates disqualified by a money fact or a staff hold. */
  skipped: number;
  failed: number;
  /** Ids of the orders this run cancelled. */
  orderIds: string[];
  failures: AutoCancelFailure[];
}

interface AutoCancelConfig {
  enabled: boolean;
  hours: number;
}

async function loadAutoCancelConfig(): Promise<AutoCancelConfig> {
  const [enabledRaw, hoursRaw] = await Promise.all([
    getSetting(AUTO_CANCEL_ENABLED_KEY),
    getSetting(AUTO_CANCEL_HOURS_KEY),
  ]);
  const parsed = hoursRaw === null ? Number.NaN : Number.parseInt(hoursRaw, 10);
  const hours =
    Number.isFinite(parsed) && parsed >= 1
      ? Math.min(parsed, AUTO_CANCEL_MAX_HOURS)
      : AUTO_CANCEL_DEFAULT_HOURS;
  return { enabled: enabledRaw === "true", hours };
}

/**
 * Fresh money check for ONE order — the same facts markOrderPayment
 * derives paymentStatus from (Σ Payment.paidPoisha + APPROVED manual
 * Trx), plus the two "money moved" records that can exist before
 * that derivation runs: a PAID gateway attempt and a gift-card
 * REDEEM. Any one of them means real money arrived and the order
 * must never be auto-cancelled.
 */
async function orderHasReceivedMoney(orderId: string): Promise<boolean> {
  const [paymentAgg, paidAttempt, approvedTrx, giftRedeem] = await Promise.all([
    prisma.payment.aggregate({
      where: { orderId, deletedAt: null },
      _sum: { paidPoisha: true },
    }),
    prisma.paymentAttempt.findFirst({
      where: { orderId, status: "PAID" },
      select: { id: true },
    }),
    prisma.manualTrxSubmission.findFirst({
      where: { orderId, status: "APPROVED" },
      select: { id: true },
    }),
    prisma.giftCardTransaction.findFirst({
      where: { orderId, kind: "REDEEM" },
      select: { id: true },
    }),
  ]);
  return (
    (paymentAgg._sum.paidPoisha ?? 0) > 0 ||
    paidAttempt !== null ||
    approvedTrx !== null ||
    giftRedeem !== null
  );
}

/** Best-effort last-run record (Setting JSON doc). Never throws. */
async function recordLastRun(
  now: Date,
  config: AutoCancelConfig,
  result: AutoCancelSweepResult,
  cancelledOrderNos: string[],
): Promise<void> {
  try {
    const doc = {
      ranAt: now.toISOString(),
      ran: result.ran,
      reason: result.reason ?? null,
      enabled: config.enabled,
      thresholdHours: config.hours,
      scanned: result.scanned,
      cancelled: result.cancelled,
      skipped: result.skipped,
      failed: result.failed,
      cancelledOrderNos: cancelledOrderNos.slice(0, SWEEP_BATCH),
      failures: result.failures,
    };
    await prisma.setting.upsert({
      where: { key: AUTO_CANCEL_LAST_RUN_KEY },
      create: {
        key: AUTO_CANCEL_LAST_RUN_KEY,
        value: JSON.stringify(doc),
        valueEncrypted: false,
        isPublic: false,
        category: "general",
        description: "Stale-unpaid auto-cancel: last sweep result (JSON, ADV-1)",
        updatedById: "system:auto-cancel",
      },
      update: { value: JSON.stringify(doc), updatedById: "system:auto-cancel" },
    });
  } catch {
    // Bookkeeping only — a failed record write must never fail or
    // mask the sweep itself.
  }
}

export async function processStaleUnpaidOrders(
  now: Date = new Date(),
): Promise<AutoCancelSweepResult> {
  const config = await loadAutoCancelConfig();

  if (!config.enabled) {
    const result: AutoCancelSweepResult = {
      ran: false,
      reason: "orders.auto_cancel.enabled is not \"true\" — auto-cancel is opt-in and stays OFF until a shop enables it",
      enabled: false,
      thresholdHours: config.hours,
      scanned: 0,
      cancelled: 0,
      skipped: 0,
      failed: 0,
      orderIds: [],
      failures: [],
    };
    await recordLastRun(now, config, result, []);
    return result;
  }

  const cutoff = new Date(now.getTime() - config.hours * 60 * 60 * 1000);
  const candidates = await prisma.order.findMany({
    where: { status: "PENDING", deletedAt: null, createdAt: { lte: cutoff } },
    orderBy: { createdAt: "asc" },
    take: SWEEP_BATCH,
    select: {
      id: true,
      orderNo: true,
      paymentStatus: true,
      advanceSatisfiedAt: true,
      heldAt: true,
    },
  });

  const reason =
    `স্বয়ংক্রিয়ভাবে বাতিল: অর্ডারটি ${config.hours} ঘণ্টার বেশি সময় ধরে অপেক্ষমাণ (PENDING) ও অবৈতনিক ছিল / ` +
    `Auto-cancelled: order stayed PENDING and unpaid for over ${config.hours} hours (Settings orders.auto_cancel.*).`;

  let cancelled = 0;
  let skipped = 0;
  let failed = 0;
  const orderIds: string[] = [];
  const cancelledOrderNos: string[] = [];
  const failures: AutoCancelFailure[] = [];

  for (const candidate of candidates) {
    try {
      // Row-level facts first (cheap), then the fresh money check —
      // both must say "no money, not held" before the funnel runs.
      if (
        candidate.paymentStatus !== "UNPAID" ||
        candidate.advanceSatisfiedAt !== null ||
        candidate.heldAt !== null ||
        (await orderHasReceivedMoney(candidate.id))
      ) {
        skipped += 1;
        continue;
      }

      const transition = await applyOrderTransition(candidate.id, "CANCELLED", SYSTEM_ACTOR, reason);
      if (transition.kind === "ok") {
        cancelled += 1;
        orderIds.push(candidate.id);
        cancelledOrderNos.push(candidate.orderNo);
      } else {
        // not_found / invalid (e.g. staff confirmed it between the
        // scan and here — the funnel re-validated and refused) /
        // blocked (no gate blocks CANCELLED today; recorded honestly
        // if one ever does). One order's refusal never stops the sweep.
        failed += 1;
        if (failures.length < FAILURE_DETAIL_CAP) {
          failures.push({
            orderId: candidate.id,
            orderNo: candidate.orderNo,
            error:
              transition.kind === "not_found"
                ? "not_found: order disappeared before the transition"
                : `${transition.kind}: ${transition.error}`,
          });
        }
      }
    } catch (error) {
      // One bad order must never kill the sweep for the rest.
      failed += 1;
      if (failures.length < FAILURE_DETAIL_CAP) {
        failures.push({
          orderId: candidate.id,
          orderNo: candidate.orderNo,
          error: `UNEXPECTED: ${error instanceof Error ? error.message : "unknown error"}`.slice(0, 500),
        });
      }
    }
  }

  const result: AutoCancelSweepResult = {
    ran: true,
    enabled: true,
    thresholdHours: config.hours,
    scanned: candidates.length,
    cancelled,
    skipped,
    failed,
    orderIds,
    failures,
  };
  await recordLastRun(now, config, result, cancelledOrderNos);
  return result;
}
