/**
 * Back-in-stock notifications — doc 21 G3-9.
 *
 * The signup side has existed since the storefront-ux wave:
 * BackInStockSignup rows persist (src/storefront-ux/back-in-stock-db.ts)
 * and the public route's comment promised "the notify job sends one
 * message when stock is restored" — but until this module, NO
 * producer, consumer, or send path existed anywhere, so a signup was
 * a dead letter the moment it was written.
 *
 * This module is the missing half, in the two halves every other SMS
 * feature here uses (cf. src/orders/otp.ts, src/orders/return-notify.ts):
 *
 *  - PRODUCER (web/worker, wherever stock moves):
 *    notifyBackInStockForVariant(variantId) finds the variant's
 *    still-unnotified signups (its own variant-level rows plus the
 *    product-level rows with variantId NULL) and enqueues ONE
 *    sms-send job per signup (jobKind "back-in-stock"). The BullMQ
 *    jobId is deterministic per signup, so a repeated restock scan
 *    cannot double-enqueue, and the processor's notifiedAt check is
 *    the second lock. Callers: the inventory ledger seam
 *    (applyMovementDb, on a 0 -> positive availability crossing) and
 *    the returns restock path (receiveReturn). Enqueueing is NOT
 *    delivery — the job waits for the VPS worker + a live SMS
 *    provider, and the producer reports exactly that (counts, never
 *    a fake "sent").
 *
 *  - SEND PATH (worker process): processBackInStockSmsJob, wired via
 *    HandlerDeps.backInStockSmsSend (src/jobs/worker-deps.ts). It
 *    re-reads the signup at send time (gone or already notified ->
 *    skip), composes the Bangla message from the product's current
 *    title, sends through the platform's SMS adapter seam, and only
 *    then stamps BackInStockSignup.notifiedAt.
 */
import { prisma } from "@advance-ecommerce/db";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";

/* ------------------------------------------------------------------ */
/* Producer queue plumbing — mirrors src/orders/return-notify.ts:      */
/* literal dynamic imports so this module never hard-fails a request   */
/* path when the queue stack is unavailable; failures are returned     */
/* outcomes, never thrown.                                             */
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
    smsQueuePromise.catch(() => {
      smsQueuePromise = null;
    });
  }
  return smsQueuePromise;
}

/* ------------------------------------------------------------------ */
/* Producer                                                            */
/* ------------------------------------------------------------------ */

export interface NotifyBackInStockResult {
  /** Jobs actually handed to the queue (a pre-existing jobId counts —
   *  BullMQ returns the existing job instead of duplicating it). */
  enqueued: number;
  signupIds: string[];
  /** Present when nothing was enqueued; says exactly why. */
  reason?: string;
}

/**
 * Enqueue one back-in-stock job per un-notified signup waiting on
 * this variant. Safe to call on every stock increase: it no-ops when
 * the variant is still unavailable (canonical ProductVariant.stock
 * cache <= 0 — signups must not be burned on stock that isn't really
 * there), when nobody is waiting, and when Redis is down (returned
 * reason, never a throw — a stock write must not fail because a
 * notification couldn't queue).
 */
export async function notifyBackInStockForVariant(
  variantId: string,
): Promise<NotifyBackInStockResult> {
  try {
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: { id: true, productId: true, stock: true },
    });
    if (variant === null) return { enqueued: 0, signupIds: [], reason: "variant-not-found" };
    if (variant.stock <= 0) return { enqueued: 0, signupIds: [], reason: "still-out-of-stock" };

    const signups = await prisma.backInStockSignup.findMany({
      where: {
        productId: variant.productId,
        notifiedAt: null,
        OR: [{ variantId }, { variantId: null }],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, phone: true },
    });
    if (signups.length === 0) return { enqueued: 0, signupIds: [], reason: "no-pending-signups" };
    if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
      return { enqueued: 0, signupIds: [], reason: "queue-unavailable: REDIS_URL not set" };
    }

    const queue = await getSmsQueue();
    const enqueuedIds: string[] = [];
    for (const signup of signups) {
      const idempotencyKey = `back-in-stock-${signup.id}`;
      const job: SmsJob = {
        templateKey: "back_in_stock",
        recipientRef: signup.id,
        jobKind: "back-in-stock",
        signupId: signup.id,
        productId: variant.productId,
        phone: signup.phone,
        idempotencyKey,
      };
      await queue.add("back-in-stock-sms", job, {
        ...bullMqJobOptions(QUEUE_NAMES.sms),
        jobId: idempotencyKey,
      });
      enqueuedIds.push(signup.id);
    }
    return { enqueued: enqueuedIds.length, signupIds: enqueuedIds };
  } catch (error) {
    return {
      enqueued: 0,
      signupIds: [],
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Send path (worker process — HandlerDeps.backInStockSmsSend)         */
/* ------------------------------------------------------------------ */

export interface BackInStockSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

/**
 * Doc 30 note: the signup row stores NO locale, so the send path has no
 * per-customer language to honour — it keeps the bn copy (the store's
 * built-in fallback locale) and passes the product's bn title. The en
 * renderer exists for the day signups record a locale.
 */
export function renderBackInStockSms(productTitle: string, locale: "bn" | "en" = "bn"): string {
  return locale === "en"
    ? `Good news! The product you were waiting for, "${productTitle}", is back in stock. Order now.`
    : `সুখবর! আপনার অপেক্ষার পণ্য "${productTitle}" আবার স্টকে এসেছে। এখনই অর্ডার করুন।`;
}

/**
 * Fire one queued back-in-stock SMS (doc 21 G3-9).
 *
 * Re-reads the signup at send time: a row that vanished skips, and a
 * row already stamped notifiedAt skips (this is the durable replay
 * guard — the handler's idempotency store is per-process, the stamp
 * is not). The recipient is the signup row's own phone. notifiedAt is
 * stamped ONLY after the provider accepts the send; a provider
 * failure throws so BullMQ retries with the row still un-notified.
 */
export async function processBackInStockSmsJob(
  job: SmsJob,
  deps: BackInStockSmsSendDeps,
): Promise<HandlerResult> {
  const signupId = job.signupId ?? (job.recipientRef !== "" ? job.recipientRef : undefined);
  if (signupId === undefined) {
    return { status: "skipped", ref: "", detail: "malformed back-in-stock payload" };
  }
  const ref = `signup-${signupId}`;

  const signup = await prisma.backInStockSignup.findUnique({
    where: { id: signupId },
    select: { id: true, productId: true, phone: true, notifiedAt: true },
  });
  if (signup === null) return { status: "skipped", ref, detail: "signup not found at send time" };
  if (signup.notifiedAt !== null) {
    return { status: "skipped", ref, detail: "signup already notified" };
  }
  const product = await prisma.product.findFirst({
    where: { id: signup.productId, deletedAt: null },
    select: { titleBn: true },
  });
  if (product === null) return { status: "skipped", ref, detail: "product not found at send time" };

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: signup.phone,
    message: renderBackInStockSms(product.titleBn),
    templateKey: job.templateKey !== "" ? job.templateKey : "back_in_stock",
    orderId: null,
  });
  await prisma.backInStockSignup.update({
    where: { id: signup.id },
    data: { notifiedAt: new Date() },
  });
  return { status: "succeeded", ref: result.messageId, detail: "back-in-stock SMS via adapter" };
}
