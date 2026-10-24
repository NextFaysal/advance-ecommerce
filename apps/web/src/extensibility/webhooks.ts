/**
 * Webhook delivery contract — Agent 17, Step 49 (A15).
 *
 * Subscriptions are data (types.ts). Delivery itself is a job: the
 * publisher enqueues a WebhookJob { event, payloadId } on the
 * "webhook-delivery" queue (src/jobs/queues.ts); the worker resolves the
 * payload + subscriptions, POSTs, and writes a WebhookDeliveryLog row.
 * Retry policy reuses DEFAULT_RETRY (3 attempts / 30 s backoff) from the
 * queue contract; after the final attempt the delivery is "dead" and
 * needs staff action — it is never silently dropped.
 *
 * Signing: HMAC-SHA256 over `${timestamp}.${body}` with the subscription
 * secret (stored encrypted in Admin Settings; the worker decrypts it at
 * send time). The signature value is never logged or stored.
 */
import { createHmac } from "node:crypto";
import { DEFAULT_RETRY, QUEUE_NAMES, type WebhookJob } from "../jobs/queues";
import type { DomainEvent, WebhookDeliveryLog, WebhookDeliveryStatus, WebhookSubscription } from "./types";

export function subscriptionsForEvent(
  subscriptions: WebhookSubscription[],
  event: DomainEvent,
): WebhookSubscription[] {
  return subscriptions.filter((s) => s.isEnabled && s.events.includes(event));
}

/** Build the exact job the publisher enqueues on the webhook queue. */
export function buildWebhookJob(event: DomainEvent, payloadId: string): { queue: string; job: WebhookJob } {
  return { queue: QUEUE_NAMES.webhook, job: { event, payloadId } };
}

export function signWebhookPayload(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function webhookHeaders(signature: string, timestamp: string, event: DomainEvent): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-ae-event": event,
    "x-ae-timestamp": timestamp,
    "x-ae-signature": `sha256=${signature}`,
  };
}

/** 2xx = delivered; 408/429/5xx = retryable; other 4xx = failed (no retry). */
export function classifyDeliveryResult(httpStatus: number | null): WebhookDeliveryStatus {
  if (httpStatus === null) return "retrying"; // network error — retry per policy
  if (httpStatus >= 200 && httpStatus < 300) return "delivered";
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) return "retrying";
  return "failed";
}

/** Status after an attempt; attempts beyond the policy become "dead". */
export function nextDeliveryStatus(httpStatus: number | null, attemptsMade: number): WebhookDeliveryStatus {
  const classified = classifyDeliveryResult(httpStatus);
  if (classified === "retrying" && attemptsMade >= DEFAULT_RETRY.attempts) return "dead";
  return classified;
}

export function emptyDeliveryLog(
  id: string,
  subscriptionId: string,
  event: DomainEvent,
  payloadId: string,
  now: Date,
): WebhookDeliveryLog {
  return {
    id,
    subscriptionId,
    event,
    payloadId,
    status: "queued",
    attempts: 0,
    httpStatus: null,
    lastError: null,
    createdAt: now.toISOString(),
    deliveredAt: null,
  };
}
