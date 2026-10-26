/**
 * Vendor portal login OTP — ADV-13 (doc 22).
 *
 * The Vendor row has no password/code credential, so portal login is
 * phone + a one-time code. This module mirrors the order-OTP
 * discipline of src/orders/otp.ts exactly:
 *
 *   - 6-digit code, only its SHA-256 hash is ever stored
 *     (hashSessionToken from src/lib/auth.ts — the same helper the
 *     session/invite tokens use);
 *   - 10-minute TTL, max 5 verify attempts (a mismatch increments;
 *     at 5 the code is dead until re-issue), 60-second resend
 *     cooldown, max 5 issues per phone per hour;
 *   - the plaintext code is returned ONCE, to the caller, for the
 *     sender — it is never persisted or logged.
 *
 * Challenge store: unlike order OTP (which persists on the Order
 * row), a login challenge has no DB row to live on and this slice
 * owns no migration — so challenges live in Redis (key
 * `vendor-login-otp:<normalizedPhone>`, TTL-bound), the same shared
 * infra the rate limiter and the BullMQ queues already use. When
 * REDIS_URL is unset the store falls back to process memory and the
 * backend is REPORTED as "memory" in every result (per-process state
 * — acceptable for a 10-minute login challenge, never hidden). If
 * Redis is configured but unreachable, issuing FAILS honestly
 * (UNAVAILABLE) instead of silently splitting state per process.
 *
 * DELIVERY — read before claiming anything: the code rides the
 * EXISTING sms-send BullMQ queue (sendVendorLoginOtpSms below).
 * Enqueued means the job sits in Redis; it does NOT mean an SMS was
 * delivered. Actual delivery needs (a) the VPS worker process
 * consuming the queue, (b) a worker branch for
 * jobKind === "vendor-login-otp" delegating to
 * processVendorLoginOtpSmsJob below (wired via a HandlerDeps dep,
 * exactly the way order-otp is wired — jobs-layer wiring owned by
 * the parent integration, listed in the ADV-13 report), and (c) the
 * platform SMS adapter, which is the sandbox simulator (labelled
 * simulated, nothing leaves the building) until a live SMS provider
 * is connected in Admin > Settings. Callers must surface "queued"
 * as queued.
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken } from "../lib/auth";
import type { SmsProvider } from "../integrations/sms";
import { QUEUE_NAMES } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import type { HandlerResult } from "../jobs/handlers";

export const VENDOR_OTP_TTL_MS = 10 * 60 * 1000;
export const VENDOR_OTP_MAX_ATTEMPTS = 5;
export const VENDOR_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const VENDOR_OTP_ISSUES_PER_HOUR = 5;

/* ------------------------------------------------------------------ */
/* Challenge store                                                     */
/* ------------------------------------------------------------------ */

export interface VendorOtpChallenge {
  codeHash: string;
  attempts: number;
  issuedAtMs: number;
  expiresAtMs: number;
  /** Issue instants inside the trailing hour (the hourly cap). */
  issueTimesMs: number[];
}

export interface VendorOtpChallengeStore {
  readonly backend: "redis" | "memory";
  get(phone: string): Promise<VendorOtpChallenge | null>;
  set(phone: string, challenge: VendorOtpChallenge): Promise<void>;
  delete(phone: string): Promise<void>;
}

class MemoryOtpChallengeStore implements VendorOtpChallengeStore {
  readonly backend = "memory" as const;
  private readonly map = new Map<string, VendorOtpChallenge>();
  async get(phone: string): Promise<VendorOtpChallenge | null> {
    return this.map.get(phone) ?? null;
  }
  async set(phone: string, challenge: VendorOtpChallenge): Promise<void> {
    this.map.set(phone, challenge);
  }
  async delete(phone: string): Promise<void> {
    this.map.delete(phone);
  }
}

/* Literal dynamic imports — never a variable specifier (Next.js
 * server bundler cannot resolve those at runtime); ioredis is in
 * next.config serverExternalPackages (see src/orders/otp.ts). */
interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "PX", ttlMs: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

interface IoRedisShape {
  default?: new (url: string, options: { maxRetriesPerRequest: null }) => RedisLike;
  Redis?: new (url: string, options: { maxRetriesPerRequest: null }) => RedisLike;
}

let redisPromise: Promise<RedisLike> | null = null;

function getRedis(): Promise<RedisLike> {
  if (redisPromise === null) {
    redisPromise = (async () => {
      const url = process.env.REDIS_URL;
      if (url === undefined || url === "") throw new Error("REDIS_URL not set");
      const ioredis = (await import("ioredis")) as unknown as IoRedisShape;
      const Ctor = ioredis.default ?? ioredis.Redis;
      if (typeof Ctor !== "function") throw new Error("ioredis constructor missing");
      return new Ctor(url, { maxRetriesPerRequest: null });
    })();
    // A failed construction must not poison the process.
    redisPromise.catch(() => {
      redisPromise = null;
    });
  }
  return redisPromise;
}

function redisKey(phone: string): string {
  return `vendor-login-otp:${phone}`;
}

class RedisOtpChallengeStore implements VendorOtpChallengeStore {
  readonly backend = "redis" as const;
  async get(phone: string): Promise<VendorOtpChallenge | null> {
    const redis = await getRedis();
    const raw = await redis.get(redisKey(phone));
    if (raw === null) return null;
    try {
      const parsed = JSON.parse(raw) as VendorOtpChallenge;
      if (typeof parsed.codeHash !== "string" || typeof parsed.expiresAtMs !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }
  async set(phone: string, challenge: VendorOtpChallenge): Promise<void> {
    const redis = await getRedis();
    const ttl = Math.max(1000, challenge.expiresAtMs - Date.now());
    await redis.set(redisKey(phone), JSON.stringify(challenge), "PX", ttl);
  }
  async delete(phone: string): Promise<void> {
    const redis = await getRedis();
    await redis.del(redisKey(phone));
  }
}

const memoryStore = new MemoryOtpChallengeStore();
const redisStore = new RedisOtpChallengeStore();

/** Production store: Redis when REDIS_URL is configured, else the
 *  labelled in-memory fallback. Injectable in tests/smokes. */
export function defaultVendorOtpStore(): VendorOtpChallengeStore {
  return process.env.REDIS_URL ? redisStore : memoryStore;
}

export interface VendorOtpDeps {
  store?: VendorOtpChallengeStore;
  nowMs?: number;
}

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

export type IssueVendorOtpResult =
  | { ok: true; code: string; backend: "redis" | "memory" }
  | { ok: false; error: "COOLDOWN" | "RATE_LIMITED"; retryAfterSeconds: number }
  | { ok: false; error: "UNAVAILABLE" };

export async function issueVendorLoginOtp(
  normalizedPhone: string,
  deps: VendorOtpDeps = {},
): Promise<IssueVendorOtpResult> {
  const store = deps.store ?? defaultVendorOtpStore();
  const now = deps.nowMs ?? Date.now();
  let existing: VendorOtpChallenge | null;
  try {
    existing = await store.get(normalizedPhone);
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
  const hourAgo = now - 60 * 60 * 1000;
  const issueTimes = (existing?.issueTimesMs ?? []).filter((t) => t > hourAgo);
  if (issueTimes.length >= VENDOR_OTP_ISSUES_PER_HOUR) {
    const oldest = Math.min(...issueTimes);
    return {
      ok: false,
      error: "RATE_LIMITED",
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + 60 * 60 * 1000 - now) / 1000)),
    };
  }
  if (
    existing !== null &&
    existing.expiresAtMs > now &&
    now - existing.issuedAtMs < VENDOR_OTP_RESEND_COOLDOWN_MS
  ) {
    return {
      ok: false,
      error: "COOLDOWN",
      retryAfterSeconds: Math.ceil((existing.issuedAtMs + VENDOR_OTP_RESEND_COOLDOWN_MS - now) / 1000),
    };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge: VendorOtpChallenge = {
    codeHash: hashSessionToken(code),
    attempts: 0,
    issuedAtMs: now,
    expiresAtMs: now + VENDOR_OTP_TTL_MS,
    issueTimesMs: [...issueTimes, now],
  };
  try {
    await store.set(normalizedPhone, challenge);
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
  return { ok: true, code, backend: store.backend };
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

export type VerifyVendorOtpResult =
  | { ok: true }
  | {
      ok: false;
      error: "NOT_ISSUED" | "EXPIRED" | "TOO_MANY_ATTEMPTS" | "MISMATCH" | "UNAVAILABLE";
      /** Present on MISMATCH: how many tries remain before the code dies. */
      attemptsLeft?: number;
    };

function hashesEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function verifyVendorLoginOtp(
  normalizedPhone: string,
  code: string,
  deps: VendorOtpDeps = {},
): Promise<VerifyVendorOtpResult> {
  const store = deps.store ?? defaultVendorOtpStore();
  const now = deps.nowMs ?? Date.now();
  let challenge: VendorOtpChallenge | null;
  try {
    challenge = await store.get(normalizedPhone);
  } catch {
    return { ok: false, error: "UNAVAILABLE" };
  }
  if (challenge === null) return { ok: false, error: "NOT_ISSUED" };
  if (challenge.attempts >= VENDOR_OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  if (now > challenge.expiresAtMs) {
    await store.delete(normalizedPhone).catch(() => undefined);
    return { ok: false, error: "EXPIRED" };
  }
  if (!hashesEqual(hashSessionToken(code), challenge.codeHash)) {
    const attempts = challenge.attempts + 1;
    await store.set(normalizedPhone, { ...challenge, attempts }).catch(() => undefined);
    if (attempts >= VENDOR_OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    return { ok: false, error: "MISMATCH", attemptsLeft: VENDOR_OTP_MAX_ATTEMPTS - attempts };
  }
  await store.delete(normalizedPhone).catch(() => undefined);
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Login orchestration (route-facing)                                  */
/* ------------------------------------------------------------------ */

export type BeginVendorLoginResult =
  | {
      ok: true;
      vendorId: string;
      otpStoreBackend: "redis" | "memory";
      delivery: { enqueued: boolean; reason?: string };
    }
  | { ok: false; error: "VENDOR_NOT_FOUND" | "VENDOR_NOT_ACTIVE" }
  | { ok: false; error: "COOLDOWN" | "RATE_LIMITED"; retryAfterSeconds: number }
  | { ok: false; error: "UNAVAILABLE" };

/**
 * Begin a portal login for a phone: the number must belong to a
 * non-deleted vendor (REJECTED vendors are refused), then a code is
 * issued and its SMS job enqueued. PENDING / ACTIVE / SUSPENDED
 * vendors may all sign in — a PENDING vendor needs the portal to
 * complete onboarding/KYC; suspension is an account state the
 * dashboard shows, not a data-access lockout invented here.
 */
export async function beginVendorLogin(
  normalizedPhone: string,
  deps: VendorOtpDeps = {},
): Promise<BeginVendorLoginResult> {
  const vendor = await prisma.vendor.findFirst({
    where: { phone: normalizedPhone, deletedAt: null },
    select: { id: true, status: true },
  });
  if (vendor === null) return { ok: false, error: "VENDOR_NOT_FOUND" };
  if (vendor.status === "REJECTED") return { ok: false, error: "VENDOR_NOT_ACTIVE" };
  const issued = await issueVendorLoginOtp(normalizedPhone, deps);
  if (!issued.ok) return issued;
  const delivery = await sendVendorLoginOtpSms(vendor.id, issued.code);
  return { ok: true, vendorId: vendor.id, otpStoreBackend: issued.backend, delivery };
}

/* ------------------------------------------------------------------ */
/* Producer: OTP SMS jobs on the EXISTING sms-send queue.              */
/* bullmq / ioredis load dynamically (the order-OTP producer         */
/* pattern) so this module never hard-fails a request path when the  */
/* queue stack is unavailable — enqueue failure is a returned        */
/* outcome, never thrown.                                              */
/* ------------------------------------------------------------------ */

export interface VendorLoginOtpSmsJob {
  templateKey: string;
  recipientRef: string;
  jobKind: "vendor-login-otp";
  vendorId: string;
  /** The 6-digit code — the otpCode precedent in src/orders/otp.ts:
   *  the store keeps only the hash, so the job is the only channel
   *  that can deliver the plaintext to the worker's send path. It is
   *  single-use, dies in 10 minutes, and must NEVER be logged. */
  otpCode: string;
  idempotencyKey: string;
}

interface VendorSmsQueueLike {
  add(name: string, data: VendorLoginOtpSmsJob, opts: Record<string, unknown>): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => VendorSmsQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisCtorShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

let smsQueuePromise: Promise<VendorSmsQueueLike> | null = null;

function getSmsQueue(): Promise<VendorSmsQueueLike> {
  if (smsQueuePromise === null) {
    smsQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = (await import("bullmq")) as unknown as BullMqProducerShape;
      const ioredis = (await import("ioredis")) as unknown as IoRedisCtorShape;
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

export type SendVendorLoginOtpSmsResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

/**
 * Queue the login-code SMS for the worker. The stable idempotency
 * key doubles as the BullMQ jobId, so re-enqueueing the SAME code
 * returns the existing job instead of a copy; a re-ISSUE (new code)
 * is a new job. Honest result: enqueued === true means the job sits
 * in Redis — NOT that an SMS was delivered (see the file header).
 */
export async function sendVendorLoginOtpSms(
  vendorId: string,
  code: string,
): Promise<SendVendorLoginOtpSmsResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const idempotencyKey = `vendor-login-otp-${vendorId}-${hashSessionToken(code).slice(0, 12)}`;
  const job: VendorLoginOtpSmsJob = {
    templateKey: "vendor_login_otp",
    recipientRef: vendorId,
    jobKind: "vendor-login-otp",
    vendorId,
    otpCode: code,
    idempotencyKey,
  };
  try {
    const queue = await getSmsQueue();
    const added = await queue.add("vendor-login-otp-sms", job, {
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
/* Send path (worker process — the HandlerDeps dep the parent wires, */
/* paralleling HandlerDeps.orderOtpSmsSend)                            */
/* ------------------------------------------------------------------ */

export interface VendorLoginOtpSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
  /** Challenge store override (worker uses the default). */
  store?: VendorOtpChallengeStore;
}

export function renderVendorLoginOtpSms(code: string): string {
  return `আপনার ভেন্ডর পোর্টাল লগইন কোড: ${code}। কোডটি ১০ মিনিটের জন্য বৈধ। কারো সাথে শেয়ার করবেন না।`;
}

/**
 * Fire one queued vendor-login OTP SMS. Re-validates at send time,
 * mirroring processOrderOtpSmsJob: the vendor must still exist, the
 * job's code must still be THE current challenge (hash match — a
 * re-issue supersedes this job, which then skips rather than texting
 * a dead code) and unexpired. The recipient phone is resolved from
 * the Vendor row here, never carried on the job. A provider-reported
 * failure THROWS so BullMQ retries per the sms queue policy.
 */
export async function processVendorLoginOtpSmsJob(
  job: VendorLoginOtpSmsJob,
  deps: VendorLoginOtpSmsSendDeps,
): Promise<HandlerResult> {
  const vendorId = job.vendorId;
  const code = job.otpCode;
  if (!vendorId || !code) {
    return { status: "skipped", ref: vendorId ?? "", detail: "malformed vendor-login-otp payload" };
  }
  const ref = `vendor-${vendorId}`;
  const vendor = await prisma.vendor.findFirst({
    where: { id: vendorId, deletedAt: null },
    select: { phone: true },
  });
  if (vendor === null) return { status: "skipped", ref, detail: "vendor not found at send time" };

  const store = deps.store ?? defaultVendorOtpStore();
  const challenge = await store.get(vendor.phone).catch(() => null);
  if (challenge === null) return { status: "skipped", ref, detail: "no active login code for vendor" };
  if (!hashesEqual(hashSessionToken(code), challenge.codeHash)) {
    return { status: "skipped", ref, detail: "superseded by a newer login code" };
  }
  if (Date.now() > challenge.expiresAtMs) {
    return { status: "skipped", ref, detail: "login code expired before send" };
  }

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: vendor.phone,
    message: renderVendorLoginOtpSms(code),
    templateKey: "vendor_login_otp",
    orderId: null,
  });
  if (result.status === "failed") throw new Error("PROVIDER_FAILED:sms");
  return { status: "succeeded", ref: result.messageId, detail: "vendor login OTP SMS via adapter" };
}
