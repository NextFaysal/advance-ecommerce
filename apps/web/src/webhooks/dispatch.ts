/**
 * Webhook dispatch — ADV-26 (doc 22).
 *
 * dispatchWebhookEvent() is the fan-out twin of the automation
 * producer: the lifecycle funnels call it next to emitAutomationEvent
 * (order.created / order.status_changed / payment.succeeded /
 * checkout.abandoned / stock.low / customer.registered). For every
 * ENABLED endpoint subscribed to the event it writes a durable
 * WebhookDelivery row (payload = the safe public shape from
 * payload.ts) and enqueues ONE job on the existing webhook-delivery
 * queue: { event, payloadId: deliveryId }.
 *
 * Contract (mirrors the automation producer):
 *  - NEVER throws into the caller — a committed funnel must not fail
 *    because webhooks hiccuped; failures come back as an outcome.
 *  - Not flag-gated on module.automation: webhooks are opt-in by the
 *    existence of an enabled endpoint. No endpoints → no rows, no jobs.
 *  - BullMQ is transport only: jobs are enqueued with attempts: 1 and
 *    a deterministic id per (delivery, attempt). The retry SCHEDULE
 *    (1m/10m/1h/6h → DEAD) lives on the delivery row (deliver.ts), so
 *    it survives worker restarts and is visible in the admin log.
 *  - When Redis is unavailable the row stays PENDING — truthfully
 *    queued, never reported as sent.
 */
import { QUEUE_NAMES, type WebhookJob } from "../jobs/queues";
import { bullMqJobOptions } from "../jobs/workers";
import { prisma } from "@advance-ecommerce/db";
import type { WebhookEventName } from "./events";
import { buildWebhookEventData, type WebhookPayload } from "./payload";
import { listEndpointsForEvent } from "./store";

/* ------------------------------------------------------------------ */
/* Queue producer (dynamic bullmq/ioredis — the producers.ts pattern)  */
/* ------------------------------------------------------------------ */

interface WebhookQueueLike {
  add(name: string, data: WebhookJob, opts: Record<string, unknown>): Promise<{ id?: string }>;
}

interface BullMqProducerShape {
  Queue: new (name: string, opts: { connection: unknown }) => WebhookQueueLike;
}

interface RedisConstructorLike {
  new (url: string, options: { maxRetriesPerRequest: null }): unknown;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

let webhookQueuePromise: Promise<WebhookQueueLike> | null = null;

function getWebhookQueue(): Promise<WebhookQueueLike> {
  if (webhookQueuePromise === null) {
    webhookQueuePromise = (async () => {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl === undefined || redisUrl === "") throw new Error("REDIS_URL not set");
      const bullmq = (await import("bullmq")) as unknown as BullMqProducerShape;
      const ioredis = (await import("ioredis")) as unknown as IoRedisShape;
      const RedisCtor = ioredis.default ?? ioredis.Redis;
      if (typeof RedisCtor !== "function") throw new Error("ioredis constructor missing");
      const connection = new RedisCtor(redisUrl, { maxRetriesPerRequest: null });
      return new bullmq.Queue(QUEUE_NAMES.webhook, { connection });
    })();
    webhookQueuePromise.catch(() => {
      webhookQueuePromise = null;
    });
  }
  return webhookQueuePromise;
}

/**
 * Enqueue one delivery attempt. `attempt` is the attempt number the
 * job will perform (1-based) — it makes the BullMQ jobId unique per
 * attempt so a scheduled retry is never swallowed as a duplicate of
 * the original job. Returns false (never throws) when the queue is
 * unavailable; the delivery row remains the source of truth.
 */
export async function enqueueWebhookDelivery(
  delivery: { id: string; event: string; attempts: number },
  opts: { delayMs?: number } = {},
): Promise<boolean> {
  if (process.env.REDIS_URL === undefined || process.env.REDIS_URL === "") return false;
  try {
    const queue = await getWebhookQueue();
    await queue.add(
      "webhook-delivery",
      { event: delivery.event, payloadId: delivery.id },
      {
        ...bullMqJobOptions(QUEUE_NAMES.webhook),
        attempts: 1, // retry schedule lives on the delivery row, not BullMQ
        jobId: `webhook-${delivery.id}-a${delivery.attempts + 1}`,
        ...(opts.delayMs && opts.delayMs > 0 ? { delay: opts.delayMs } : {}),
      },
    );
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Fan-out                                                             */
/* ------------------------------------------------------------------ */

export interface WebhookDispatchResult {
  /** Delivery rows created (one per subscribed enabled endpoint). */
  created: number;
  /** Of those, how many were successfully enqueued. */
  enqueued: number;
  skipped?: "no_endpoints" | "error";
}

/**
 * Fan one lifecycle event out to subscribed endpoints. Fire-and-forget
 * by contract: funnel callers await it (it is fast: one endpoint list,
 * N row writes, N queue adds) but it can never throw into them.
 */
export async function dispatchWebhookEvent(
  event: WebhookEventName,
  entityId: string | null,
  deps: { enqueue?: typeof enqueueWebhookDelivery } = {},
): Promise<WebhookDispatchResult> {
  try {
    const endpoints = await listEndpointsForEvent(event);
    if (endpoints.length === 0) return { created: 0, enqueued: 0, skipped: "no_endpoints" };

    const data = await buildWebhookEventData(event, entityId);
    const enqueue = deps.enqueue ?? enqueueWebhookDelivery;
    let created = 0;
    let enqueued = 0;
    for (const endpoint of endpoints) {
      // Two writes: the payload embeds the delivery id (receivers
      // dedupe on it), so the row exists before its payload is final.
      const row = await prisma.webhookDelivery.create({
        data: { endpointId: endpoint.id, event, entityId, payloadJson: {}, status: "PENDING" },
      });
      const payload: WebhookPayload = {
        id: row.id,
        event,
        createdAt: row.createdAt.toISOString(),
        data,
      };
      const final = await prisma.webhookDelivery.update({
        where: { id: row.id },
        data: { payloadJson: payload as never },
      });
      created += 1;
      if (await enqueue(final)) enqueued += 1;
    }
    return { created, enqueued };
  } catch (error) {
    console.warn("[webhooks] dispatch failed", {
      event,
      entityId,
      error: error instanceof Error ? error.name : "unknown-error",
    });
    return { created: 0, enqueued: 0, skipped: "error" };
  }
}

/** Test ping: a webhook.test delivery to ONE endpoint (admin action). */
export async function dispatchTestPing(
  endpointId: string,
  deps: { enqueue?: typeof enqueueWebhookDelivery } = {},
): Promise<{ deliveryId: string; enqueued: boolean } | null> {
  const endpoint = await prisma.webhookEndpoint.findUnique({ where: { id: endpointId } });
  if (!endpoint) return null;
  const row = await prisma.webhookDelivery.create({
    data: {
      endpointId,
      event: "webhook.test",
      entityId: endpointId,
      payloadJson: {},
      status: "PENDING",
    },
  });
  const payload: WebhookPayload = {
    id: row.id,
    event: "webhook.test",
    createdAt: row.createdAt.toISOString(),
    data: { test: true, endpointId, endpointName: endpoint.name },
  };
  const final = await prisma.webhookDelivery.update({
    where: { id: row.id },
    data: { payloadJson: payload as never },
  });
  const enqueue = deps.enqueue ?? enqueueWebhookDelivery;
  const enqueued = await enqueue(final);
  return { deliveryId: row.id, enqueued };
}
