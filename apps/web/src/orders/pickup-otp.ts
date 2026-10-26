/**
 * Pickup OTP — ADV-19 remainder (click & collect handover proof).
 *
 * Click & collect orders that carry a named pickup point (the
 * `[pickup:<id>]` marker in the create-time OrderNote, written by the
 * public orders route — src/checkout/pickup-points.ts) get a one-time
 * code the customer shows at the counter. The lifecycle mirrors the
 * CONFIRMED-gate order OTP (src/orders/otp.ts) and reuses its
 * primitives — SHA-256 hash-only storage via hashSessionToken,
 * persisted attempt counter, supersede-on-reissue — but on SEPARATE
 * Order columns (pickupOtp*) so the two lifecycles never interact:
 *
 *   ensurePickupOtpForConfirmedOrder(orderId)
 *     — called by applyOrderTransition after a transition INTO
 *       CONFIRMED commits. There is no distinct "pickup ready" status
 *       in the state machine (PENDING -> CONFIRMED -> PROCESSING ->
 *       PACKED -> SHIPPED -> DELIVERED), so the code is issued at
 *       CONFIRMED and the SMS tells the customer to show it at pickup.
 *       Issues at most one live code: an already-issued (unverified)
 *       code is left alone, so a replayed hook never rotates a code
 *       the customer already received.
 *   verifyPickupOtp(orderId, code)
 *     — staff-side check (admin route, orders.edit). Success stamps
 *       pickupOtpVerifiedAt and clears the hash.
 *   pickupDeliveryBlock(orderId)
 *     — the DELIVERED gate applyOrderTransition consults: a pickup
 *       order with an issued-but-unverified code cannot be marked
 *       DELIVERED (409 PICKUP_OTP_INVALID at the route).
 *
 * TTL is 24 hours, not the order OTP's 10 minutes: pickup happens
 * hours after confirmation, and a 10-minute code would ALWAYS be
 * expired at the counter. Staff can re-issue from the admin order
 * page (resend route) — a re-issue supersedes the old code.
 *
 * FAIL-OPEN BOUNDARY (deliberate): orders confirmed before this
 * feature existed never got a code issued (pickupOtpExpiresAt stays
 * NULL). The gate blocks ONLY orders with an issued code — legacy
 * pickup orders are never trapped at the counter by a code nobody
 * was sent.
 *
 * HONESTY — delivery: issuing a code ENQUEUES an SMS on the existing
 * sms-send queue (jobKind "pickup-otp"). Enqueued is not sent: the
 * message leaves only when the VPS worker consumes the queue, and
 * then through the configured SMS adapter (sandbox = simulated until
 * a live provider is connected in Admin > Settings). The worker send
 * path (processPickupOtpSmsJob, wired via HandlerDeps.pickupOtpSmsSend)
 * re-validates the world at send time exactly like the order-OTP
 * path: pickup order, code still current (hash match), unexpired,
 * unverified.
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken } from "../lib/auth";
import { PICKUP_NOTE_MARKER_PREFIX } from "../checkout/pickup-points";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";

export const PICKUP_OTP_TTL_MS = 24 * 60 * 60 * 1000;
export const PICKUP_OTP_MAX_ATTEMPTS = 5;

function hashesEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Pickup-order detection                                              */
/* ------------------------------------------------------------------ */

/** True when the order's notes carry a `[pickup:<id>]` choice marker. */
export async function isPickupOrder(orderId: string): Promise<boolean> {
  const note = await prisma.orderNote.findFirst({
    where: { orderId, text: { contains: PICKUP_NOTE_MARKER_PREFIX } },
    select: { id: true },
  });
  return note !== null;
}

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

/**
 * Mint a fresh pickup code for the order and persist only its hash.
 * Any previously issued code dies here (hash replaced, attempts
 * reset). Throws Error("ORDER_NOT_FOUND") for an unknown id.
 */
export async function issuePickupOtp(orderId: string): Promise<{ code: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (order === null) throw new Error("ORDER_NOT_FOUND");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.order.update({
    where: { id: orderId },
    data: {
      pickupOtpCodeHash: hashSessionToken(code),
      pickupOtpExpiresAt: new Date(Date.now() + PICKUP_OTP_TTL_MS),
      pickupOtpAttempts: 0,
      pickupOtpVerifiedAt: null,
    },
  });
  return { code };
}

/* ------------------------------------------------------------------ */
/* Confirm-time hook (called from applyOrderTransition)                */
/* ------------------------------------------------------------------ */

export type EnsurePickupOtpResult =
  | { issued: true; smsEnqueued: boolean }
  | { issued: false; reason: string };

/**
 * After a pickup order is CONFIRMED: issue its pickup code (once) and
 * queue the SMS. NEVER throws — a failure here must not fail the
 * confirm that already committed; staff can re-issue from the admin
 * order page. Non-pickup orders and already-issued/already-verified
 * orders are no-ops.
 */
export async function ensurePickupOtpForConfirmedOrder(
  orderId: string,
): Promise<EnsurePickupOtpResult> {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { pickupOtpCodeHash: true, pickupOtpVerifiedAt: true },
    });
    if (order === null) return { issued: false, reason: "order not found" };
    if (order.pickupOtpVerifiedAt !== null) return { issued: false, reason: "already verified" };
    if (order.pickupOtpCodeHash !== null) return { issued: false, reason: "already issued" };
    if (!(await isPickupOrder(orderId))) return { issued: false, reason: "not a pickup order" };

    const { code } = await issuePickupOtp(orderId);
    const sms = await sendPickupOtpSms(orderId, code);
    return { issued: true, smsEnqueued: sms.enqueued };
  } catch (error) {
    return {
      issued: false,
      reason: `issue failed: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

export type VerifyPickupOtpResult =
  | { ok: true }
  | {
      ok: false;
      error: "EXPIRED" | "TOO_MANY_ATTEMPTS" | "MISMATCH" | "NOT_ISSUED" | "ALREADY_VERIFIED";
      attemptsLeft?: number;
    };

export async function verifyPickupOtp(orderId: string, code: string): Promise<VerifyPickupOtpResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pickupOtpCodeHash: true,
      pickupOtpExpiresAt: true,
      pickupOtpAttempts: true,
      pickupOtpVerifiedAt: true,
    },
  });
  if (order === null) return { ok: false, error: "NOT_ISSUED" };
  if (order.pickupOtpVerifiedAt !== null) return { ok: false, error: "ALREADY_VERIFIED" };
  if (order.pickupOtpCodeHash === null || order.pickupOtpExpiresAt === null) {
    return { ok: false, error: "NOT_ISSUED" };
  }
  if (order.pickupOtpAttempts >= PICKUP_OTP_MAX_ATTEMPTS) {
    return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  }
  if (Date.now() > order.pickupOtpExpiresAt.getTime()) return { ok: false, error: "EXPIRED" };

  if (!hashesEqual(hashSessionToken(code), order.pickupOtpCodeHash)) {
    const attempts = order.pickupOtpAttempts + 1;
    await prisma.order.update({ where: { id: orderId }, data: { pickupOtpAttempts: attempts } });
    if (attempts >= PICKUP_OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    return { ok: false, error: "MISMATCH", attemptsLeft: PICKUP_OTP_MAX_ATTEMPTS - attempts };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { pickupOtpVerifiedAt: new Date(), pickupOtpCodeHash: null },
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* DELIVERED gate + admin status                                       */
/* ------------------------------------------------------------------ */

/**
 * The block applyOrderTransition returns for an unverified pickup
 * handover, or null when the transition may proceed. See the header
 * for the fail-open boundary (no code ever issued -> no block).
 */
export async function pickupDeliveryBlock(
  orderId: string,
): Promise<{ code: "PICKUP_OTP_INVALID"; message: string } | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { pickupOtpCodeHash: true, pickupOtpExpiresAt: true, pickupOtpVerifiedAt: true },
  });
  if (order === null) return null;
  if (order.pickupOtpVerifiedAt !== null) return null;
  if (order.pickupOtpCodeHash === null && order.pickupOtpExpiresAt === null) return null;
  if (!(await isPickupOrder(orderId))) return null;
  return {
    code: "PICKUP_OTP_INVALID",
    message:
      "পিকআপ OTP যাচাই ছাড়া এই অর্ডার ডেলিভার্ড করা যাবে না — কাস্টমারের ফোনে পাঠানো কোডটি অর্ডার পেজে যাচাই করুন। / This pickup order cannot be marked delivered until the customer's pickup OTP is verified.",
  };
}

export interface PickupOtpStatus {
  /** The order carries a [pickup:<id>] marker. */
  applicable: boolean;
  issued: boolean;
  verified: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  attemptsLeft: number | null;
}

export async function getPickupOtpStatus(orderId: string): Promise<PickupOtpStatus | null> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      pickupOtpCodeHash: true,
      pickupOtpExpiresAt: true,
      pickupOtpAttempts: true,
      pickupOtpVerifiedAt: true,
    },
  });
  if (order === null) return null;
  const applicable = await isPickupOrder(orderId);
  const issued = order.pickupOtpExpiresAt !== null;
  return {
    applicable,
    issued,
    verified: order.pickupOtpVerifiedAt !== null,
    verifiedAt: order.pickupOtpVerifiedAt?.toISOString() ?? null,
    expiresAt: order.pickupOtpExpiresAt?.toISOString() ?? null,
    expired:
      order.pickupOtpExpiresAt !== null && Date.now() > order.pickupOtpExpiresAt.getTime(),
    attemptsLeft: issued
      ? Math.max(0, PICKUP_OTP_MAX_ATTEMPTS - order.pickupOtpAttempts)
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Producer: pickup-OTP SMS jobs on the EXISTING sms-send queue.       */
/* Same dynamic-load discipline as src/orders/otp.ts: bullmq/ioredis   */
/* load lazily so a request path never hard-fails when the queue       */
/* stack is unavailable — enqueue failure is a returned outcome.       */
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

export type SendPickupOtpSmsResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

/**
 * Queue the pickup-OTP SMS for the worker. Honest contract, same as
 * the order OTP: enqueued === true means the job sits in Redis — it
 * does NOT mean an SMS reached the customer (that needs the worker
 * host + a live SMS provider).
 */
export async function sendPickupOtpSms(orderId: string, code: string): Promise<SendPickupOtpSmsResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const idempotencyKey = `pickup-otp-${orderId}-${hashSessionToken(code).slice(0, 12)}`;
  const job: SmsJob = {
    orderId,
    templateKey: "pickup_otp",
    recipientRef: orderId,
    jobKind: "pickup-otp",
    purpose: "pickup_otp",
    otpCode: code,
    idempotencyKey,
  };
  try {
    const queue = await getSmsQueue();
    const added = await queue.add("pickup-otp-sms", job, {
      ...bullMqJobOptions(QUEUE_NAMES.sms),
      jobId: idempotencyKey,
    });
    return { enqueued: true, jobId: added.id ?? idempotencyKey };
  } catch (error) {
    return {
      enqueued: false,
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Send path (worker process — HandlerDeps.pickupOtpSmsSend)           */
/* ------------------------------------------------------------------ */

export interface PickupOtpSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

export function renderPickupOtpSms(orderNo: string, code: string): string {
  return `আপনার অর্ডার ${orderNo} নিশ্চিত হয়েছে। পিকআপ পয়েন্ট থেকে সংগ্রহের সময় এই কোডটি দেখাবেন: ${code}। কোডটি ২৪ ঘণ্টার জন্য বৈধ। কারো সাথে শেয়ার করবেন না।`;
}

/**
 * Fire one queued pickup-OTP SMS. Re-validates at send time, mirroring
 * processOrderOtpSmsJob: pickup order, the job's code still THE
 * current code (hash match — a staff re-issue supersedes this job),
 * unexpired, unverified. Recipient resolved from the Order row.
 */
export async function processPickupOtpSmsJob(
  job: SmsJob,
  deps: PickupOtpSmsSendDeps,
): Promise<HandlerResult> {
  const orderId = job.orderId;
  const code = job.otpCode;
  if (orderId === undefined || code === undefined || code === "") {
    return { status: "skipped", ref: orderId ?? "", detail: "malformed pickup-otp payload" };
  }
  const ref = `order-${orderId}`;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNo: true,
      customerPhone: true,
      pickupOtpCodeHash: true,
      pickupOtpExpiresAt: true,
      pickupOtpVerifiedAt: true,
    },
  });
  if (order === null) return { status: "skipped", ref, detail: "order not found at send time" };
  if (order.pickupOtpVerifiedAt !== null) {
    return { status: "skipped", ref, detail: "pickup already OTP-verified" };
  }
  if (order.pickupOtpCodeHash === null || order.pickupOtpExpiresAt === null) {
    return { status: "skipped", ref, detail: "no active pickup OTP code on the order" };
  }
  if (!hashesEqual(hashSessionToken(code), order.pickupOtpCodeHash)) {
    return { status: "skipped", ref, detail: "superseded by a newer pickup OTP code" };
  }
  if (Date.now() > order.pickupOtpExpiresAt.getTime()) {
    return { status: "skipped", ref, detail: "pickup OTP code expired before send" };
  }
  if (!(await isPickupOrder(orderId))) {
    return { status: "skipped", ref, detail: "order is not a pickup order" };
  }

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: order.customerPhone,
    message: renderPickupOtpSms(order.orderNo, code),
    templateKey: "pickup_otp",
    orderId,
  });
  return { status: "succeeded", ref: result.messageId, detail: "pickup OTP SMS via adapter" };
}
