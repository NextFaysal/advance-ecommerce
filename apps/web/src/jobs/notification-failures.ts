/**
 * Notification failure recording + retry producer — ADV-10 (doc 22),
 * doc 21 G3-12.
 *
 * Until this module existed the notification-retry queue was DEAD:
 * its runner (src/jobs/runners.ts createNotificationRetryRunner)
 * re-drives FAILED NotificationLog rows, but nothing anywhere CREATED
 * NotificationLog rows, and nothing enqueued NotificationRetryJobs.
 * This module is the missing input side:
 *
 *  - recordNotificationFailure() writes the FAILED row when a
 *    notification send exhausts its origin queue's retries in the
 *    worker handlers (src/jobs/handlers.ts wires it for the generic
 *    SMS path, the generic email path and the ADV-3 emailSend
 *    delegation — the three direct notification send seams there).
 *  - enqueueNotificationRetry() produces the retry job with a delay
 *    (backoff) on the "notification-retry" queue; its BullMQ retry
 *    policy (DEFAULT_RETRY via bullMqJobOptions) governs the
 *    re-drive attempts from there.
 *  - recordFailureAndScheduleRetry() is the never-throw combination
 *    the handlers call on a final-attempt failure: bookkeeping must
 *    never mask the send failure itself, so every step is isolated
 *    and the outcome is returned, not thrown.
 *
 * Data discipline: the row carries ids / refs / codes only —
 * recipientRef is the payload's ref (never a raw phone/email beyond
 * what the payload itself carried), errorRef is an error CODE (first
 * token), never a provider message. The NotificationLog schema
 * supports all of this today (channel / templateKey / recipientRef /
 * orderId / status FAILED / provider / errorRef) — no migration.
 *
 * ACCEPTED SENDS + DLR (schema wave 2, 2026-10-26): NotificationLog
 * gained providerMessageId, and recordSmsSendAccepted() below now
 * writes a SENT row for every accepted REAL-provider SMS send on the
 * paths that opt in (the generic SMS handler + the automation SMS
 * effect). The DLR webhook joins provider callbacks to those rows
 * through src/jobs/delivery-reports.ts. Sandbox/simulated sends are
 * deliberately NOT recorded: their ids are invented locally, no DLR
 * will ever arrive for them, and a row would invite a false match.
 *
 * Delegated SMS flavours (order-otp / callcenter-automation /
 * return-update / back-in-stock) are deliberately NOT recorded here:
 * they keep their own failure records (the call-center dead-letter
 * timeline row, the processors' dead-letter entries) and their
 * recipientRef is an entity id, not a sendable ref — re-driving them
 * through the generic retry runner would send to an id. They are
 * noted as such in the queues.ts inventory.
 */
import { prisma } from "@advance-ecommerce/db";
import { QUEUE_NAMES } from "./queues";
import type { NotificationRetryJob } from "./handlers";
import { bullMqJobOptions } from "./workers";

export type NotificationFailureChannel = "SMS" | "EMAIL";

export interface NotificationFailureInput {
  channel: NotificationFailureChannel;
  templateKey?: string | null;
  /** The job payload's recipient ref — ids/refs only, as logged. */
  recipientRef: string;
  orderId?: string | null;
  /** Provider name when known (never a credential). */
  provider?: string | null;
  /** Error CODE only (e.g. "PROVIDER_FAILED") — never a raw message. */
  errorCode: string;
}

const CHANNEL_TO_JOB_CHANNEL: Record<NotificationFailureChannel, NotificationRetryJob["channel"]> = {
  SMS: "sms",
  EMAIL: "email",
};

/** First backoff before the retry runner re-drives the row. */
export const NOTIFICATION_RETRY_DELAY_SECONDS = 60;

/**
 * Create the FAILED NotificationLog row. Returns the row id, or null
 * when the write itself failed (DB down) — the caller logs the null;
 * a lost bookkeeping row must never fail the job a second time.
 */
export async function recordNotificationFailure(
  input: NotificationFailureInput,
): Promise<{ id: string } | null> {
  try {
    const row = await prisma.notificationLog.create({
      data: {
        channel: input.channel,
        templateKey: input.templateKey ?? null,
        recipientRef: input.recipientRef,
        orderId: input.orderId ?? null,
        status: "FAILED",
        provider: input.provider ?? null,
        errorRef: input.errorCode.slice(0, 120),
      },
      select: { id: true },
    });
    return row;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Retry producer (lazy BullMQ, the src/orders/otp.ts pattern)         */
/* ------------------------------------------------------------------ */

interface NotificationRetryQueueLike {
  add(
    name: string,
    data: NotificationRetryJob,
    opts?: Record<string, unknown>,
  ): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => NotificationRetryQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

/** Literal dynamic imports — never a variable specifier (Next.js
 *  server bundler cannot resolve those at runtime). */
async function loadBullMq(): Promise<BullMqProducerShape> {
  return (await import("bullmq")) as unknown as BullMqProducerShape;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let retryQueuePromise: Promise<NotificationRetryQueueLike> | null = null;

function getNotificationRetryQueue(): Promise<NotificationRetryQueueLike> {
  if (retryQueuePromise === null) {
    retryQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") {
        throw new Error("REDIS_URL not set");
      }
      const bullmq = await loadBullMq();
      const ioredis = await loadIoRedis();
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.notificationRetry, { connection });
    })();
    retryQueuePromise.catch(() => {
      retryQueuePromise = null;
    });
  }
  return retryQueuePromise;
}

export type EnqueueNotificationRetryResult =
  | { enqueued: true; jobId: string }
  | { enqueued: false; reason: string };

/**
 * Enqueue the re-drive of one FAILED NotificationLog row, delayed by
 * NOTIFICATION_RETRY_DELAY_SECONDS (the backoff between the origin
 * send's exhaustion and the retry; BullMQ's exponential policy on
 * the notification-retry queue backs off further from there). The
 * BullMQ jobId is derived from the row id, so a duplicate schedule
 * for the same row returns the existing job instead of a copy.
 * Honest result: enqueued === true means the job sits in Redis; the
 * re-drive itself happens only when a worker host runs.
 */
export async function enqueueNotificationRetry(
  notificationLogId: string,
  channel: NotificationRetryJob["channel"],
  injectedQueue?: NotificationRetryQueueLike,
): Promise<EnqueueNotificationRetryResult> {
  if (injectedQueue === undefined && (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "")) {
    return { enqueued: false, reason: "queue-unavailable: REDIS_URL not set" };
  }
  const jobId = `notification-retry-${notificationLogId}`;
  try {
    const queue = injectedQueue ?? (await getNotificationRetryQueue());
    const added = await queue.add(
      "notification-retry",
      { notificationLogId, channel },
      {
        ...bullMqJobOptions(QUEUE_NAMES.notificationRetry),
        delay: NOTIFICATION_RETRY_DELAY_SECONDS * 1000,
        jobId,
      },
    );
    return { enqueued: true, jobId: added.id ?? jobId };
  } catch (error) {
    return {
      enqueued: false,
      reason: `queue-unavailable: ${error instanceof Error ? error.name : "unknown-error"}`,
    };
  }
}

/**
 * The handlers' one call on a final-attempt send failure: record the
 * FAILED row, then schedule its retry. NEVER throws — both outcomes
 * are reported so the handler can log them (ids/codes only).
 */
export async function recordFailureAndScheduleRetry(
  input: NotificationFailureInput,
): Promise<{ recorded: boolean; notificationLogId: string | null; retryEnqueued: boolean }> {
  const row = await recordNotificationFailure(input);
  if (row === null) return { recorded: false, notificationLogId: null, retryEnqueued: false };
  const retry = await enqueueNotificationRetry(row.id, CHANNEL_TO_JOB_CHANNEL[input.channel]);
  return { recorded: true, notificationLogId: row.id, retryEnqueued: retry.enqueued };
}

/* ------------------------------------------------------------------ */
/* Accepted SMS sends — the DLR join target (schema wave 2)            */
/* ------------------------------------------------------------------ */

export interface SmsSendAcceptedInput {
  templateKey?: string | null;
  /** The send payload's recipient ref — as logged (payload-carried). */
  recipientRef: string;
  orderId?: string | null;
  /** Provider name (never a credential). */
  provider: string;
  /** The provider's message id — the DLR join key. */
  providerMessageId: string;
  segments?: number | null;
}

/**
 * Write the SENT NotificationLog row for one accepted SMS send,
 * carrying the provider message id the DLR webhook will match on.
 * Called ONLY for real-provider sends (callers gate on the provider
 * not being the sandbox simulator). Returns the row id, or null when
 * the write failed — NEVER throws: a lost bookkeeping row must not
 * fail a send that already happened.
 */
export async function recordSmsSendAccepted(
  input: SmsSendAcceptedInput,
): Promise<{ id: string } | null> {
  if (input.providerMessageId === "") return null;
  try {
    const row = await prisma.notificationLog.create({
      data: {
        channel: "SMS",
        templateKey: input.templateKey ?? null,
        recipientRef: input.recipientRef,
        orderId: input.orderId ?? null,
        status: "SENT",
        provider: input.provider,
        providerMessageId: input.providerMessageId,
        segments: input.segments != null ? String(input.segments) : null,
      },
      select: { id: true },
    });
    return row;
  } catch {
    return null;
  }
}
