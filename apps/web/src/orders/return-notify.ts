/**
 * Return status notifications — doc 17 batch O7 (part 2).
 *
 * Whenever a return changes status, staff and customers both need to
 * hear about it. The customer-visible truth is the account returns
 * list (GET /api/v1/public/account/returns — always available, no
 * worker needed). This module adds the SMS leg: it enqueues ONE job
 * on the EXISTING sms-send BullMQ queue with jobKind "return-update"
 * and payload { returnId, phone, status } — the phone resolved
 * server-side from the Order row, never from client input.
 *
 * HONESTY — delivery: enqueueing is NOT delivery. The job sits in
 * Redis until the VPS worker + a live SMS provider exist (the same
 * caveat as the order-OTP jobs in src/orders/otp.ts, whose producer
 * pattern this file mirrors). Callers surface the outcome exactly:
 * { sms: "queued" } only when the job really landed in the queue,
 * { sms: "not_queued", reason } otherwise — never a fake "sent".
 *
 * WIRING: this module is called from the surfaces O7-2 owns — the
 * customer self-service create (status REQUESTED) and the exchange
 * route (status EXCHANGED). O7-1's admin transition routes should call
 * notifyReturnStatus(returnId, <newStatus>) after each successful
 * lifecycle move (APPROVED / REJECTED / RECEIVED / COMPLETED) — the
 * seam is this single exported function; it needs nothing else.
 */
import { prisma } from "@advance-ecommerce/db";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";

/* ------------------------------------------------------------------ */
/* Producer: return-update SMS jobs on the EXISTING sms-send queue.    */
/* bullmq / ioredis load dynamically (the otp.ts pattern) so this      */
/* module never hard-fails a request path when the queue stack is      */
/* unavailable — enqueue failure is a returned outcome, never thrown.  */
/* ------------------------------------------------------------------ */

interface SmsQueueLike {
  add(name: string, data: SmsJob, opts: Record<string, unknown>): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => SmsQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

/** Literal dynamic imports — never a variable specifier (Next.js
 *  server bundler cannot resolve those at runtime). bullmq/ioredis
 *  are in next.config serverExternalPackages. */
async function loadBullMq(): Promise<BullMqProducerShape> {
  return (await import("bullmq")) as unknown as BullMqProducerShape;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let smsQueuePromise: Promise<SmsQueueLike> | null = null;

function getSmsQueue(): Promise<SmsQueueLike> {
  if (smsQueuePromise === null) {
    smsQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = await loadBullMq();
      const ioredis = await loadIoRedis();
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.sms, { connection });
    })();
    // A failed construction must not poison the process — the next
    // notify retries (e.g. after REDIS_URL appears).
    smsQueuePromise.catch(() => {
      smsQueuePromise = null;
    });
  }
  return smsQueuePromise;
}

export type NotifyReturnStatusResult =
  | { sms: "queued"; jobId: string }
  | { sms: "not_queued"; reason: string };

/**
 * Enqueue the customer SMS for a return's new status.
 *
 * `status` is the status the return has JUST moved to (REQUESTED from
 * the self-service create, EXCHANGED from the exchange route, and —
 * once the parent wires O7-1's transition routes — APPROVED /
 * REJECTED / RECEIVED / COMPLETED from admin moves).
 *
 * The jobId is deterministic per (returnId, status) so a retried
 * request cannot double-text the customer about the same move; a
 * later move to a DIFFERENT status is a new job.
 */
export async function notifyReturnStatus(
  returnId: string,
  status: string,
): Promise<NotifyReturnStatusResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { sms: "not_queued", reason: "queue-unavailable: REDIS_URL not set" };
  }
  const ret = await prisma.return.findFirst({
    where: { id: returnId, deletedAt: null },
    select: { id: true, orderId: true },
  });
  if (ret === null) return { sms: "not_queued", reason: "return-not-found" };
  const order = await prisma.order.findFirst({
    where: { id: ret.orderId, deletedAt: null },
    select: { id: true, customerPhone: true },
  });
  if (order === null) return { sms: "not_queued", reason: "order-not-found" };

  const idempotencyKey = `return-update-${returnId}-${status.toLowerCase()}`;
  const job: SmsJob = {
    orderId: order.id,
    templateKey: "return_update",
    recipientRef: returnId,
    jobKind: "return-update",
    returnId,
    phone: order.customerPhone,
    status,
    idempotencyKey,
  };
  try {
    const queue = await getSmsQueue();
    const added = await queue.add("return-update-sms", job, {
      ...bullMqJobOptions(QUEUE_NAMES.sms),
      jobId: idempotencyKey,
    });
    return { sms: "queued", jobId: added.id ?? idempotencyKey };
  } catch (error) {
    return {
      sms: "not_queued",
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}
