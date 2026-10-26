/**
 * Webhook event catalogue — ADV-26 (doc 22), developer platform core.
 *
 * The subscribable events are exactly the lifecycle events the
 * automation producers fire (src/automation/producers.ts emit seam):
 * the webhook fan-out in dispatch.ts is called from the same funnels,
 * so an endpoint can only subscribe to events that really happen.
 * `webhook.test` is the admin "test ping" event — it fires only when
 * staff send one, never from a funnel.
 *
 * Delivery semantics (deliver.ts owns the state machine):
 *  - a delivery is SENT only on a real 2xx from the target;
 *  - failures retry on RETRY_BACKOFF_MS (1m / 10m / 1h / 6h);
 *  - after MAX_DELIVERY_ATTEMPTS total attempts the delivery is DEAD
 *    and needs a manual redeliver from /admin/webhooks.
 */

export const WEBHOOK_EVENTS = [
  "order.created",
  "order.status_changed",
  "payment.succeeded",
  "checkout.abandoned",
  "stock.low",
  "customer.registered",
  "webhook.test",
] as const;

export type WebhookEventName = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEventName(value: string): value is WebhookEventName {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

/** Total attempts before a delivery is DEAD (1 initial + 4 retries). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Delay before retry N+1 after attempt N fails (attempts 1..4). */
export const RETRY_BACKOFF_MS: readonly number[] = [
  60_000, // after attempt 1 → 1 minute
  600_000, // after attempt 2 → 10 minutes
  3_600_000, // after attempt 3 → 1 hour
  21_600_000, // after attempt 4 → 6 hours
];

/** Per-attempt HTTP timeout. */
export const DELIVERY_TIMEOUT_MS = 10_000;

/** Response-body evidence kept on the delivery row (chars). */
export const RESPONSE_SNIPPET_CHARS = 200;
