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
 *
 * SEND PATH (doc 21 G3-1 fix): the worker side lives at the bottom of
 * this file — processReturnUpdateSmsJob, wired via
 * HandlerDeps.returnUpdateSmsSend (src/jobs/worker-deps.ts). Before
 * that fix existed, the SMS handler had no branch for
 * jobKind "return-update" and the generic path "sent" an empty
 * message addressed to the return id and reported success — the
 * customer got nothing. The branch now delegates here, exactly like
 * order-otp: the job is re-validated against the Return row at send
 * time and the message is composed from the payload's status.
 */
import { prisma } from "@advance-ecommerce/db";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";

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
    select: { id: true, orderNo: true, customerPhone: true },
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
    orderNo: order.orderNo,
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

/* ------------------------------------------------------------------ */
/* Send path (worker process — HandlerDeps.returnUpdateSmsSend)        */
/* ------------------------------------------------------------------ */

export interface ReturnUpdateSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

/** Customer-facing Bangla line per return status (the RMA lifecycle
 *  values plus the legacy ones kept for compat). Unknown statuses get
 *  the generic "status updated" line — never an empty message. */
const RETURN_STATUS_TEXT_BN: Record<string, string> = {
  REQUESTED: "আপনার রিটার্ন অনুরোধটি পেয়েছি। আমাদের টিম যাচাই করে পরবর্তী ধাপ জানাবে",
  APPROVED: "আপনার রিটার্ন অনুরোধ অনুমোদিত হয়েছে",
  RETURNING: "আপনার ফেরত পণ্য আমাদের পথে রয়েছে",
  RECEIVED: "আপনার ফেরত পণ্য আমরা হাতে পেয়েছি",
  RETURNED: "আপনার ফেরত পণ্য আমরা হাতে পেয়েছি",
  REFUNDED: "আপনার রিফান্ড সম্পন্ন হয়েছে",
  COMPLETED: "আপনার রিটার্ন সম্পন্ন হয়েছে। রিফান্ডের অবস্থা আপনার অ্যাকাউন্টে দেখুন",
  EXCHANGED: "আপনার এক্সচেঞ্জ সম্পন্ন হয়েছে",
  REJECTED: "দুঃখিত, আপনার রিটার্ন অনুরোধটি গৃহীত হয়নি। বিস্তারিত জানতে আমাদের সাথে যোগাযোগ করুন",
  CLOSED: "আপনার রিটার্নটি বন্ধ করা হয়েছে",
};

export function renderReturnUpdateSms(orderNo: string, status: string): string {
  const text = RETURN_STATUS_TEXT_BN[status] ?? "আপনার রিটার্নের অবস্থা আপডেট হয়েছে";
  const orderRef = orderNo !== "" ? `অর্ডার ${orderNo}: ` : "";
  return `${orderRef}${text}।`;
}

/**
 * Fire one queued return-update SMS (doc 21 G3-1).
 *
 * Re-validates at send time, mirroring processOrderOtpSmsJob: the
 * return must still exist and must STILL be in the status this job
 * announces — lifecycle moves are monotonic, so a job processed after
 * the return moved on is superseded and SKIPS rather than texting the
 * customer a stale step (the newer move has its own job). The
 * recipient is the job payload's `phone` (resolved server-side from
 * the Order row at enqueue time, never client input); the order
 * number comes from the payload, falling back to the DB for jobs
 * enqueued before the producer carried it. A provider-reported
 * failure THROWS so BullMQ retries per the sms queue policy — this
 * path must never report a success it did not perform.
 */
export async function processReturnUpdateSmsJob(
  job: SmsJob,
  deps: ReturnUpdateSmsSendDeps,
): Promise<HandlerResult> {
  const returnId = job.returnId ?? (job.recipientRef !== "" ? job.recipientRef : undefined);
  const phone = job.phone;
  const status = job.status;
  if (
    returnId === undefined ||
    phone === undefined ||
    phone === "" ||
    status === undefined ||
    status === ""
  ) {
    return { status: "skipped", ref: returnId ?? "", detail: "malformed return-update payload" };
  }
  const ref = `return-${returnId}`;

  const ret = await prisma.return.findFirst({
    where: { id: returnId, deletedAt: null },
    select: { id: true, status: true, orderId: true },
  });
  if (ret === null) return { status: "skipped", ref, detail: "return not found at send time" };
  if (String(ret.status) !== status) {
    return { status: "skipped", ref, detail: "superseded by a newer return status" };
  }
  let orderNo = job.orderNo ?? "";
  if (orderNo === "") {
    const order = await prisma.order.findFirst({
      where: { id: ret.orderId, deletedAt: null },
      select: { orderNo: true },
    });
    orderNo = order?.orderNo ?? "";
  }

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: phone,
    message: renderReturnUpdateSms(orderNo, status),
    templateKey: job.templateKey !== "" ? job.templateKey : "return_update",
    orderId: job.orderId ?? ret.orderId,
  });
  return { status: "succeeded", ref: result.messageId, detail: "return update SMS via adapter" };
}
