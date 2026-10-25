/**
 * Order OTP verification — doc 17 batch O3 (advance/prepaid enforcement).
 *
 * Some orders must be verified by a one-time code before staff may
 * confirm them: fraud "require_advance" orders and any order the
 * checkout flagged with requiresOtp (the flag + the otp* columns are
 * persisted by createOrderRecord — schema contract from batch O3-1:
 * Order.requiresOtp / otpCodeHash / otpExpiresAt / otpAttempts /
 * otpVerifiedAt). This module owns the code lifecycle:
 *
 *   issueOrderOtp(orderId)   — mint a 6-digit code, store ONLY its
 *                              SHA-256 hash (the same helper session /
 *                              invite tokens use: hashSessionToken in
 *                              src/lib/auth.ts), 10-minute expiry,
 *                              attempt counter reset. The plaintext is
 *                              returned ONCE, to the caller, for the
 *                              sender — it is never persisted.
 *   verifyOrderOtp(id, code) — constant-shape result; max 5 attempts
 *                              (a mismatch increments; at 5 the code
 *                              is dead until re-issue); success stamps
 *                              otpVerifiedAt and clears the hash.
 *   sendOrderOtpSms(id, code)— enqueue the delivery on the EXISTING
 *                              sms-send BullMQ queue (jobKind
 *                              "order-otp", ids-only payload except
 *                              the code itself — see SmsJob.otpCode).
 *
 * HONESTY — delivery: enqueueing is NOT delivery. The message is sent
 * only when the VPS worker process runs and consumes the queue, and
 * even then through the platform's SMS adapter (today a sandbox
 * adapter: simulated, no real SMS leaves the building) until Nazmul
 * connects a live SMS provider with credentials in Admin > Settings.
 * Callers must surface "queued" as queued — see the resend endpoint's
 * response meta. The worker-side send path lives in this same file
 * (processOrderOtpSmsJob, wired via HandlerDeps.orderOtpSmsSend) and
 * re-validates the world at send time: order still flagged, code
 * still the current one (hash match), not expired, not yet verified.
 *
 * Rate limiting follows the codebase's per-feature in-memory limiter
 * pattern (cf. src/reviews/policy.ts): verify attempts are capped by
 * the persisted otpAttempts counter (durable), and this limiter adds
 * a per-(order, phone) request ceiling on top; resends are bounded by
 * the 60-second cooldown + an hourly cap. In-memory means per-process
 * — acceptable because the durable caps live in the DB row.
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken } from "../lib/auth";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
/** otpExpiresAt − issuedAt is always OTP_TTL_MS (issueOrderOtp), so the
 *  issue instant is recoverable from the row alone. */
const OTP_RESEND_PER_HOUR = 5;
const OTP_VERIFY_PER_10_MIN = 10;

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

/**
 * Mint a fresh code for the order and persist only its hash. Any
 * previously issued code dies here (hash replaced, attempts reset).
 * Throws Error("ORDER_NOT_FOUND") for an unknown id — route callers
 * pre-check existence + phone binding, so this is a defensive guard
 * for direct service callers.
 */
export async function issueOrderOtp(orderId: string): Promise<{ code: string }> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (order === null) throw new Error("ORDER_NOT_FOUND");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.order.update({
    where: { id: orderId },
    data: {
      otpCodeHash: hashSessionToken(code),
      otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
    },
  });
  return { code };
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

export type VerifyOrderOtpResult =
  | { ok: true }
  | {
      ok: false;
      error: "EXPIRED" | "TOO_MANY_ATTEMPTS" | "MISMATCH" | "NOT_REQUIRED" | "ALREADY_VERIFIED";
      /** Present on MISMATCH: how many tries remain before the code dies. */
      attemptsLeft?: number;
    };

function hashesEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function verifyOrderOtp(orderId: string, code: string): Promise<VerifyOrderOtpResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      requiresOtp: true,
      otpCodeHash: true,
      otpExpiresAt: true,
      otpAttempts: true,
      otpVerifiedAt: true,
    },
  });
  // The public route pre-checks existence (404); a vanished row here
  // is reported in the same constant shape as "nothing to verify".
  if (order === null) return { ok: false, error: "NOT_REQUIRED" };
  if (order.otpVerifiedAt !== null) return { ok: false, error: "ALREADY_VERIFIED" };
  if (!order.requiresOtp || order.otpCodeHash === null || order.otpExpiresAt === null) {
    return { ok: false, error: "NOT_REQUIRED" };
  }
  if (order.otpAttempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  if (Date.now() > order.otpExpiresAt.getTime()) return { ok: false, error: "EXPIRED" };

  if (!hashesEqual(hashSessionToken(code), order.otpCodeHash)) {
    const attempts = order.otpAttempts + 1;
    await prisma.order.update({ where: { id: orderId }, data: { otpAttempts: attempts } });
    if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    return { ok: false, error: "MISMATCH", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { otpVerifiedAt: new Date(), otpCodeHash: null },
  });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Resend cooldown (route helper)                                      */
/* ------------------------------------------------------------------ */

export type ResendOtpCheck =
  | { allowed: true }
  | { allowed: false; error: "NOT_REQUIRED" | "ALREADY_VERIFIED" | "COOLDOWN"; retryAfterSeconds?: number };

/**
 * May a new code be issued for this order right now? The cooldown is
 * derived from the row alone: the last issue instant is
 * otpExpiresAt − OTP_TTL_MS. No code ever issued (otpExpiresAt null)
 * means the resend IS the first issue — allowed.
 */
export async function checkOtpResend(orderId: string, now: Date = new Date()): Promise<ResendOtpCheck> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { requiresOtp: true, otpExpiresAt: true, otpVerifiedAt: true },
  });
  if (order === null || !order.requiresOtp) return { allowed: false, error: "NOT_REQUIRED" };
  if (order.otpVerifiedAt !== null) return { allowed: false, error: "ALREADY_VERIFIED" };
  if (order.otpExpiresAt !== null) {
    const issuedAtMs = order.otpExpiresAt.getTime() - OTP_TTL_MS;
    const elapsed = now.getTime() - issuedAtMs;
    if (elapsed < OTP_RESEND_COOLDOWN_MS) {
      return {
        allowed: false,
        error: "COOLDOWN",
        retryAfterSeconds: Math.ceil((OTP_RESEND_COOLDOWN_MS - elapsed) / 1000),
      };
    }
  }
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/* Per-process request limiter (durable caps live on the Order row)    */
/* ------------------------------------------------------------------ */

class OtpRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /** Record one hit and report whether the window cap is exceeded. */
  check(key: string, limit: number, windowMs: number, now: Date = new Date()): { allowed: boolean } {
    const cutoff = now.getTime() - windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    recent.push(now.getTime());
    this.hits.set(key, recent);
    if (this.hits.size > 5000) {
      // Crude memory guard: drop idle keys wholesale.
      for (const [k, v] of this.hits) if (v.every((t) => t <= cutoff)) this.hits.delete(k);
    }
    return { allowed: recent.length <= limit };
  }
}

export const otpRateLimiter = new OtpRateLimiter();

export function otpVerifyRateKey(orderId: string, normalizedPhone: string): string {
  return `verify:${orderId}:${normalizedPhone}`;
}

export function otpResendRateKey(orderId: string, normalizedPhone: string): string {
  return `resend:${orderId}:${normalizedPhone}`;
}

export function checkOtpVerifyRate(orderId: string, normalizedPhone: string): boolean {
  return otpRateLimiter.check(otpVerifyRateKey(orderId, normalizedPhone), OTP_VERIFY_PER_10_MIN, 10 * 60 * 1000).allowed;
}

export function checkOtpResendRate(orderId: string, normalizedPhone: string): boolean {
  return otpRateLimiter.check(otpResendRateKey(orderId, normalizedPhone), OTP_RESEND_PER_HOUR, 60 * 60 * 1000).allowed;
}

/* ------------------------------------------------------------------ */
/* Producer: OTP SMS jobs on the EXISTING sms-send queue.              */
/* bullmq / ioredis load dynamically (the call-center automation     */
/* pattern) so this module never hard-fails a request path when the   */
/* queue stack is unavailable — enqueue failure is a returned         */
/* outcome, never thrown.                                             */
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
    // send retries (e.g. after REDIS_URL appears).
    smsQueuePromise.catch(() => {
      smsQueuePromise = null;
    });
  }
  return smsQueuePromise;
}

export type SendOrderOtpSmsResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

/**
 * Queue the OTP SMS for the worker. Payload conventions mirror the
 * call-center automation jobs: ids only (the phone is resolved from
 * the Order row at send time), the code being the single documented
 * exception (SmsJob.otpCode). The stable idempotency key doubles as
 * the BullMQ jobId, so re-enqueueing the SAME code returns the
 * existing job instead of a copy; a re-ISSUE (new code) is a new job.
 *
 * The result is honest: enqueued === true means the job sits in
 * Redis. It does NOT mean an SMS was delivered — that needs the VPS
 * worker + a live SMS provider (see the file header).
 */
export async function sendOrderOtpSms(orderId: string, code: string): Promise<SendOrderOtpSmsResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const idempotencyKey = `order-otp-${orderId}-${hashSessionToken(code).slice(0, 12)}`;
  const job: SmsJob = {
    orderId,
    templateKey: "order_otp",
    recipientRef: orderId,
    jobKind: "order-otp",
    purpose: "order_otp",
    otpCode: code,
    idempotencyKey,
  };
  try {
    const queue = await getSmsQueue();
    const added = await queue.add("order-otp-sms", job, {
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
/* Send path (worker process — HandlerDeps.orderOtpSmsSend)            */
/* ------------------------------------------------------------------ */

export interface OrderOtpSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

export function renderOrderOtpSms(orderNo: string, code: string): string {
  return `আপনার অর্ডার ${orderNo} যাচাইয়ের কোড: ${code}। কোডটি ১০ মিনিটের জন্য বৈধ। কারো সাথে শেয়ার করবেন না।`;
}

/**
 * Fire one queued order-OTP SMS. Re-validates at send time, mirroring
 * the call-center send path: the order must still require OTP, the
 * job's code must still be THE current code (hash match — a re-issue
 * supersedes this job, which then skips rather than texting a dead
 * code), the code must be unexpired and the order unverified. The
 * recipient phone is resolved from the Order row here, never carried
 * on the job. A provider-reported failure THROWS so BullMQ retries
 * per the sms queue policy.
 */
export async function processOrderOtpSmsJob(
  job: SmsJob,
  deps: OrderOtpSmsSendDeps,
): Promise<HandlerResult> {
  const orderId = job.orderId;
  const code = job.otpCode;
  if (orderId === undefined || code === undefined || code === "") {
    return { status: "skipped", ref: orderId ?? "", detail: "malformed order-otp payload" };
  }
  const ref = `order-${orderId}`;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      orderNo: true,
      customerPhone: true,
      requiresOtp: true,
      otpCodeHash: true,
      otpExpiresAt: true,
      otpVerifiedAt: true,
    },
  });
  if (order === null) return { status: "skipped", ref, detail: "order not found at send time" };
  if (!order.requiresOtp) return { status: "skipped", ref, detail: "order no longer requires OTP" };
  if (order.otpVerifiedAt !== null) return { status: "skipped", ref, detail: "order already OTP-verified" };
  if (order.otpCodeHash === null || order.otpExpiresAt === null) {
    return { status: "skipped", ref, detail: "no active OTP code on the order" };
  }
  if (!hashesEqual(hashSessionToken(code), order.otpCodeHash)) {
    return { status: "skipped", ref, detail: "superseded by a newer OTP code" };
  }
  if (Date.now() > order.otpExpiresAt.getTime()) {
    return { status: "skipped", ref, detail: "OTP code expired before send" };
  }

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: order.customerPhone,
    message: renderOrderOtpSms(order.orderNo, code),
    templateKey: "order_otp",
    orderId,
  });
  return { status: "succeeded", ref: result.messageId, detail: "order OTP SMS via adapter" };
}
