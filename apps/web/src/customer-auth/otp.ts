/**
 * Customer phone-OTP login — doc 22 ADV-15 (spec §1: OTP-primary).
 *
 * The sibling of the order OTP service (src/orders/otp.ts): the order
 * service is bound to Order rows, so this one persists through the
 * generic `OtpCode` table (phone + purpose + codeHash + attempts +
 * expiresAt + consumedAt — the model existed unused for exactly this
 * kind of challenge). The RULES are not re-invented: TTL, attempt cap
 * and resend cooldown are IMPORTED from src/orders/otp.ts so the two
 * services can never drift apart, and only the code's SHA-256 hash
 * (hashSessionToken, the same helper) is ever stored. The plaintext
 * code is returned ONCE from issueAuthOtp, for the SMS producer.
 *
 *   issueAuthOtp(phone)   — mint a 6-digit code for purpose
 *                           "customer_login"; any older code for the
 *                           phone is implicitly superseded (verify
 *                           only ever reads the LATEST row).
 *   verifyAuthOtp(p, code)— constant-shape result mirroring
 *                           verifyOrderOtp; a mismatch increments the
 *                           persisted attempt counter, at 5 the code
 *                           is dead (even the right code is refused)
 *                           until a new code is issued; success stamps
 *                           consumedAt.
 *   checkAuthOtpResend(p) — 60s cooldown + 5/hour cap, derived from
 *                           the rows themselves (durable, not the
 *                           per-process limiter).
 *   sendAuthOtpSms(id, code) — producer on the EXISTING sms-send
 *                           BullMQ queue, mirroring sendOrderOtpSms:
 *                           ids-only payload (recipientRef = the
 *                           OtpCode row id; the phone is resolved from
 *                           the row at send time) with otpCode as the
 *                           single documented secret exception — the
 *                           same exception SmsJob.otpCode documents
 *                           for order OTP.
 *   processAuthOtpSmsJob  — the worker-side send path, mirroring
 *                           processOrderOtpSmsJob: re-validates at
 *                           send time (row still latest + unconsumed,
 *                           hash match, unexpired) before sending.
 *                           PARENT SEAM: it is wired into the worker
 *                           by adding an "auth-otp" branch in
 *                           src/jobs/handlers.ts + a HandlerDeps entry
 *                           assembled in src/jobs/worker-deps.ts —
 *                           two lines, deliberately left to the
 *                           parent integration (this module does not
 *                           touch src/jobs). Until wired, jobs wait
 *                           on the queue; nothing here claims a send.
 *
 * HONESTY — delivery: enqueueing is NOT delivery, and the route meta
 * says so (delivery: "queued", deliveryMode from the ADV-2 resolver's
 * own verdict: "provider" when a real gateway is configured in
 * Settings, "simulated" when the platform falls back to the sandbox
 * adapter). Even with a live provider the SMS leaves only when the
 * VPS worker runs. resolveAuthOtpDelivery() below is that verdict —
 * it calls the same resolver the worker uses, never a guess.
 */
import { randomInt, timingSafeEqual } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { SMS_PROVIDERS, type SmsProvider, type SmsProviderName } from "@/integrations/sms";
import { QUEUE_NAMES, type SmsJob } from "@/jobs/queues";
import { bullMqJobOptions } from "@/jobs/workers";
import type { HandlerResult } from "@/jobs/handlers";
import {
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_MS,
  OTP_TTL_MS,
} from "@/orders/otp";
import { fireCustomerRegistered, toPublicCustomer, type PublicCustomer } from "./auth";

export const AUTH_OTP_PURPOSE = "customer_login";
const AUTH_OTP_RESEND_PER_HOUR = 5;

export { OTP_TTL_MS as AUTH_OTP_TTL_MS, OTP_MAX_ATTEMPTS as AUTH_OTP_MAX_ATTEMPTS };

/* ------------------------------------------------------------------ */
/* Issue                                                               */
/* ------------------------------------------------------------------ */

export async function issueAuthOtp(
  normalizedPhone: string,
): Promise<{ otpId: string; code: string }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = await prisma.otpCode.create({
    data: {
      phone: normalizedPhone,
      purpose: AUTH_OTP_PURPOSE,
      codeHash: hashSessionToken(code),
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
      attempts: 0,
    },
  });
  return { otpId: row.id, code };
}

/* ------------------------------------------------------------------ */
/* Verify                                                              */
/* ------------------------------------------------------------------ */

export type VerifyAuthOtpResult =
  | { ok: true }
  | {
      ok: false;
      error: "EXPIRED" | "TOO_MANY_ATTEMPTS" | "MISMATCH" | "NO_ACTIVE_CODE";
      /** Present on MISMATCH: how many tries remain before the code dies. */
      attemptsLeft?: number;
    };

function hashesEqual(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, "hex");
  const b = Buffer.from(bHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The current code row for a phone: the LATEST one issued. Older
 *  rows are superseded by construction — verify never reads them. */
async function latestAuthOtp(normalizedPhone: string) {
  return prisma.otpCode.findFirst({
    where: { phone: normalizedPhone, purpose: AUTH_OTP_PURPOSE },
    orderBy: { createdAt: "desc" },
  });
}

export async function verifyAuthOtp(
  normalizedPhone: string,
  code: string,
): Promise<VerifyAuthOtpResult> {
  const row = await latestAuthOtp(normalizedPhone);
  if (row === null || row.consumedAt !== null) return { ok: false, error: "NO_ACTIVE_CODE" };
  if (row.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
  if (Date.now() > row.expiresAt.getTime()) return { ok: false, error: "EXPIRED" };

  if (!hashesEqual(hashSessionToken(code), row.codeHash)) {
    const attempts = row.attempts + 1;
    await prisma.otpCode.update({ where: { id: row.id }, data: { attempts } });
    if (attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "TOO_MANY_ATTEMPTS" };
    return { ok: false, error: "MISMATCH", attemptsLeft: OTP_MAX_ATTEMPTS - attempts };
  }

  await prisma.otpCode.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Resend cooldown (route helper)                                      */
/* ------------------------------------------------------------------ */

export type ResendAuthOtpCheck =
  | { allowed: true }
  | {
      allowed: false;
      error: "COOLDOWN" | "HOURLY_CAP";
      retryAfterSeconds?: number;
    };

/**
 * May a new code be issued for this phone right now? Mirrors the
 * order OTP policy (60s cooldown + 5/hour), derived from the rows:
 * the latest row's createdAt is the last issue instant.
 */
export async function checkAuthOtpResend(
  normalizedPhone: string,
  now: Date = new Date(),
): Promise<ResendAuthOtpCheck> {
  const [latest, issuedLastHour] = await Promise.all([
    latestAuthOtp(normalizedPhone),
    prisma.otpCode.count({
      where: {
        phone: normalizedPhone,
        purpose: AUTH_OTP_PURPOSE,
        createdAt: { gt: new Date(now.getTime() - 60 * 60 * 1000) },
      },
    }),
  ]);
  if (issuedLastHour >= AUTH_OTP_RESEND_PER_HOUR) {
    return { allowed: false, error: "HOURLY_CAP", retryAfterSeconds: 60 * 60 };
  }
  if (latest !== null) {
    const elapsed = now.getTime() - latest.createdAt.getTime();
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
/* Customer resolution — registration-by-OTP.                         */
/* A verified phone IS the account key (same row password            */
/* registration claims): an existing row is used as-is (a guest row  */
/* from past checkouts is thereby claimed — its orders attach via    */
/* customerId, nothing is copied), a new phone creates the account   */
/* with NO password. Blocked / soft-deleted rows fail generically.   */
/*                                                                    */
/* PRODUCER: the create branch is a REGISTRATION and fires            */
/* CUSTOMER_REGISTERED exactly once via auth.ts's                     */
/* fireCustomerRegistered (the password path's seam — automation      */
/* event + webhook dispatch, which also fans out to connectors).      */
/* The existing-row branch is a LOGIN and never fires it.             */
/* ------------------------------------------------------------------ */

export async function findOrCreateCustomerForPhone(
  normalizedPhone: string,
): Promise<PublicCustomer | null> {
  const existing = await prisma.customer.findUnique({ where: { phone: normalizedPhone } });
  if (existing !== null) {
    if (existing.blocked || existing.deletedAt !== null) return null;
    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return toPublicCustomer(updated);
  }
  // No name is known yet on an OTP-first signup — a neutral label the
  // customer-facing profile shows until staff/the customer set one.
  const created = await prisma.customer.create({
    data: { name: "গ্রাহক", phone: normalizedPhone, email: null, passwordHash: null, tags: [] },
  });
  // Registration producer (wave 52): a brand-new account created by
  // OTP fires CUSTOMER_REGISTERED exactly once, through the same seam
  // the password path uses. This line is reachable ONLY on creation —
  // the existing-row branch above returns earlier (login), and this
  // function itself is called only after verifyAuthOtp succeeded, so
  // a failed verification can never reach it.
  await fireCustomerRegistered(created.id);
  return toPublicCustomer(created);
}

/* ------------------------------------------------------------------ */
/* Delivery verdict — the ADV-2 resolver's own answer, reused for    */
/* the request route's meta. Mirrors worker-deps' resolveSmsProvider */
/* assembly exactly: a fully configured gateway in Settings means    */
/* the worker will send through a real provider; anything else      */
/* means the sandbox simulator (labelled "simulated").               */
/* ------------------------------------------------------------------ */

export async function resolveAuthOtpDelivery(): Promise<{
  mode: "provider" | "simulated";
  provider: string;
}> {
  try {
    const resolver = await import("@/integrations/sms-resolver");
    const settings = await import("@/lib/settings");
    const resolved = await resolver.resolveConfiguredSmsProvider(
      {
        getSetting: (key) => settings.getSetting(key),
        getProviderSecrets: async (provider) =>
          settings.getIntegrationConfigWithSecrets("sms", provider),
      },
      null,
    );
    if (resolved !== null) return { mode: "provider", provider: resolved.providerName };
  } catch {
    // fall through to the sandbox verdict, like the worker does
  }
  const configured = await getSetting("sms.provider").catch(() => null);
  const name =
    configured !== null && (SMS_PROVIDERS as readonly string[]).includes(configured)
      ? (configured as SmsProviderName)
      : "bulksmsbd";
  return { mode: "simulated", provider: name };
}

/* ------------------------------------------------------------------ */
/* Producer: auth-OTP SMS jobs on the EXISTING sms-send queue.        */
/* Mirrors sendOrderOtpSms (src/orders/otp.ts): bullmq / ioredis     */
/* load dynamically with LITERAL specifiers so this module never     */
/* hard-fails a request path when the queue stack is unavailable —   */
/* enqueue failure is a returned outcome, never thrown.              */
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

export type SendAuthOtpSmsResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

/**
 * Queue the login-OTP SMS for the worker. Ids-only payload:
 * recipientRef is the OtpCode row id and the recipient phone is
 * resolved from that row at send time (processAuthOtpSmsJob); the
 * code itself rides otpCode — the single documented secret exception
 * on SmsJob, exactly as for order OTP. The stable idempotency key
 * doubles as the BullMQ jobId, so re-enqueueing the SAME code
 * returns the existing job instead of a copy.
 *
 * enqueued === true means the job sits in Redis. It does NOT mean
 * an SMS was delivered — see the file header.
 */
export async function sendAuthOtpSms(otpId: string, code: string): Promise<SendAuthOtpSmsResult> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const idempotencyKey = `auth-otp-${otpId}-${hashSessionToken(code).slice(0, 12)}`;
  const job: SmsJob = {
    templateKey: "auth_otp",
    recipientRef: otpId,
    jobKind: "auth-otp",
    otpCode: code,
    idempotencyKey,
  };
  try {
    const queue = await getSmsQueue();
    const added = await queue.add("auth-otp-sms", job, {
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
/* Send path (worker process — wire as HandlerDeps.authOtpSmsSend,   */
/* parent seam, see header). Mirrors processOrderOtpSmsJob: the      */
/* code is re-validated against the stored hash at send time and     */
/* the phone is resolved from the DB row, never from the payload.    */
/* ------------------------------------------------------------------ */

export interface AuthOtpSmsSendDeps {
  /** The platform's SMS adapter resolver (worker-deps passes its own). */
  smsProvider: (providerName: string | null) => Promise<SmsProvider>;
}

export function renderAuthOtpSms(code: string): string {
  return `আপনার লগইন কোড: ${code}। কোডটি ১০ মিনিটের জন্য বৈধ। কারো সাথে শেয়ার করবেন না।`;
}

export async function processAuthOtpSmsJob(
  job: SmsJob,
  deps: AuthOtpSmsSendDeps,
): Promise<HandlerResult> {
  const otpId = job.recipientRef;
  const code = job.otpCode;
  if (otpId === "" || code === undefined || code === "") {
    return { status: "skipped", ref: otpId, detail: "malformed auth-otp payload" };
  }
  const ref = `auth-otp-${otpId}`;

  const row = await prisma.otpCode.findUnique({ where: { id: otpId } });
  if (row === null) return { status: "skipped", ref, detail: "OTP row not found at send time" };
  if (row.purpose !== AUTH_OTP_PURPOSE || row.phone === null) {
    return { status: "skipped", ref, detail: "not a customer-login OTP row" };
  }
  if (row.consumedAt !== null) return { status: "skipped", ref, detail: "code already consumed" };
  if (!hashesEqual(hashSessionToken(code), row.codeHash)) {
    return { status: "skipped", ref, detail: "code does not match the stored hash" };
  }
  const latest = await latestAuthOtp(row.phone);
  if (latest === null || latest.id !== row.id) {
    return { status: "skipped", ref, detail: "superseded by a newer login code" };
  }
  if (Date.now() > row.expiresAt.getTime()) {
    return { status: "skipped", ref, detail: "OTP code expired before send" };
  }

  const provider = await deps.smsProvider(null);
  const result = await provider.send({
    toPhone: row.phone,
    message: renderAuthOtpSms(code),
    templateKey: "auth_otp",
    orderId: null,
  });
  return { status: "succeeded", ref: result.messageId, detail: "auth OTP SMS via adapter" };
}
