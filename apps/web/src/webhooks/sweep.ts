/**
 * Webhook delivery sweeper — doc 23 wave 54-4 (ADV-26 follow-up).
 *
 * processWebhookDelivery (deliver.ts) schedules each retry as a
 * delayed BullMQ job at fail time. If that enqueue itself failed
 * (Redis down at that moment) the delivery row is left FAILED with a
 * nextRetryAt in the past and NOTHING re-drives it — before this
 * sweep the only recovery was a staff redeliver from /admin/webhooks.
 * This sweep is the worker-side recovery: it finds those stuck rows
 * and re-enqueues them through the SAME producer the dispatcher
 * uses (dispatch.ts enqueueWebhookDelivery — same queue, same job
 * shape { event, payloadId }, same attempts: 1 contract).
 *
 * ELIGIBILITY (exactly these rows, oldest retry first):
 *   status = "FAILED"
 *   AND attempts < MAX_DELIVERY_ATTEMPTS (5)
 *   AND nextRetryAt IS NOT NULL AND nextRetryAt <= now
 *   AND the endpoint is still enabled (a disabled endpoint's rows
 *       wait — the delivery processor would no-op them anyway; if
 *       staff re-enable the endpoint they become eligible again).
 * DEAD rows are never touched: status DEAD is terminal by design and
 * resurrecting one would silently exceed the 5-attempt contract —
 * DEAD needs a human redeliver from the admin. SENT rows are final.
 * PENDING rows are out of scope: nextRetryAt is null until a first
 * attempt has run, and initial-enqueue orphans are visible in the
 * admin log for staff redeliver.
 *
 * DOUBLE-QUEUE SAFETY: the producer's BullMQ jobId is deterministic
 * per (delivery, attempt) — `webhook-<id>-a<attempts+1>` — so if the
 * originally scheduled retry job is still sitting in the queue
 * (worker down, Redis kept it), re-adding under the same id is a
 * BullMQ dedupe no-op, never a second job. `requeued` therefore
 * means "a job for the pending attempt is now guaranteed present",
 * freshly added or already there.
 *
 * Per-sweep cap: WEBHOOK_SWEEP_BATCH rows — a backlog drains over
 * successive sweeps instead of flooding the queue in one tick.
 */
import { prisma } from "@advance-ecommerce/db";
import { MAX_DELIVERY_ATTEMPTS } from "./events";
import { enqueueWebhookDelivery } from "./dispatch";

/** Max deliveries re-driven per sweep run. */
export const WEBHOOK_SWEEP_BATCH = 100;

export interface WebhookSweepResult {
  /** Eligible rows found (<= WEBHOOK_SWEEP_BATCH). */
  scanned: number;
  /** Rows whose pending-attempt job is now guaranteed queued. */
  requeued: number;
  /** Eligible rows whose enqueue failed (queue unavailable). */
  skipped: number;
}

export async function sweepStaleWebhookDeliveries(
  now: Date,
  deps: { enqueue?: typeof enqueueWebhookDelivery } = {},
): Promise<WebhookSweepResult> {
  const enqueue = deps.enqueue ?? enqueueWebhookDelivery;
  const rows = await prisma.webhookDelivery.findMany({
    where: {
      status: "FAILED",
      attempts: { lt: MAX_DELIVERY_ATTEMPTS },
      nextRetryAt: { not: null, lte: now },
      endpoint: { enabled: true },
    },
    orderBy: { nextRetryAt: "asc" },
    take: WEBHOOK_SWEEP_BATCH,
    select: { id: true, event: true, attempts: true },
  });
  let requeued = 0;
  let skipped = 0;
  for (const row of rows) {
    // No delay: the stored retry time has already passed.
    const ok = await enqueue(row).catch(() => false);
    if (ok) requeued += 1;
    else skipped += 1;
  }
  return { scanned: rows.length, requeued, skipped };
}
