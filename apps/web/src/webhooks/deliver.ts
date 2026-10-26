/**
 * Webhook delivery processor — ADV-26 (doc 22).
 *
 * processWebhookDelivery(deliveryId) performs ONE attempt of a
 * WebhookDelivery row and advances its state machine:
 *
 *   PENDING/FAILED --2xx--> SENT                     (final)
 *   PENDING/FAILED --fail--> FAILED + nextRetryAt    (attempts < 5)
 *   PENDING/FAILED --fail--> DEAD                    (attempt 5)
 *
 * A delivery is SENT only on a real 2xx from the target — nothing
 * else is ever reported as delivered. The retry schedule is
 * re-enqueued as a delayed BullMQ job per attempt (dispatch.ts); if
 * that enqueue fails the row still carries nextRetryAt, so the state
 * is truthful and a staff redeliver can recover it.
 *
 * Signing: HMAC-SHA256 hex of the exact raw body bytes, header
 * X-AE-Signature; X-AE-Event + X-AE-Delivery identify the event and
 * the delivery (receivers dedupe on X-AE-Delivery / payload.id).
 * The secret is decrypted in-process only — never logged or stored.
 *
 * Wired into the worker as HandlerDeps.webhookFanout (worker-deps):
 * the handlers.ts webhook branch delegates { event, payloadId } jobs
 * here with payloadId = delivery id. A job whose payloadId is not a
 * delivery id (legacy producers) completes as a no-op ref — it must
 * not throw, or BullMQ would retry a job that can never succeed.
 */
import { createHmac } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import {
  DELIVERY_TIMEOUT_MS,
  MAX_DELIVERY_ATTEMPTS,
  RESPONSE_SNIPPET_CHARS,
  RETRY_BACKOFF_MS,
} from "./events";
import { enqueueWebhookDelivery } from "./dispatch";
import { assertWebhookUrlAllowed, WebhookUrlError } from "./ssrf";
import { resolveEndpointSecret } from "./store";

export interface WebhookDeliveryDeps {
  fetchImpl?: typeof fetch;
  enqueue?: typeof enqueueWebhookDelivery;
  now?: () => Date;
}

export interface WebhookDeliveryOutcome {
  deliveredToRef: string;
  status: "SENT" | "FAILED" | "DEAD" | "PENDING" | "UNKNOWN";
}

export function signWebhookBody(secret: string, body: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export async function processWebhookDelivery(
  deliveryId: string,
  deps: WebhookDeliveryDeps = {},
): Promise<WebhookDeliveryOutcome> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const enqueue = deps.enqueue ?? enqueueWebhookDelivery;
  const now = deps.now ?? (() => new Date());

  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { endpoint: true },
  });
  if (!delivery) {
    return { deliveredToRef: `whd:${deliveryId}:unknown`, status: "UNKNOWN" };
  }
  const ref = (s: string) => `whd:${deliveryId}:${s}`;

  if (delivery.status === "SENT" || delivery.status === "DEAD") {
    return { deliveredToRef: ref(delivery.status.toLowerCase()), status: delivery.status };
  }
  if (!delivery.endpoint.enabled) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { lastError: "endpoint_disabled" },
    });
    return { deliveredToRef: ref("pending"), status: "PENDING" };
  }

  const attempt = delivery.attempts + 1;

  // Terminal configuration failures: retrying cannot fix them.
  const failTerminal = async (lastError: string): Promise<WebhookDeliveryOutcome> => {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: "DEAD", attempts: attempt, lastError, nextRetryAt: null },
    });
    return { deliveredToRef: ref("dead"), status: "DEAD" };
  };

  try {
    assertWebhookUrlAllowed(delivery.endpoint.url);
  } catch (error) {
    if (error instanceof WebhookUrlError) return failTerminal(`url_${error.code.toLowerCase()}`);
    throw error;
  }

  const secret = await resolveEndpointSecret(delivery.endpointId);
  if (secret === null || secret === "") return failTerminal("signing_secret_unavailable");

  const body = JSON.stringify(delivery.payloadJson);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-ae-event": delivery.event,
    "x-ae-delivery": delivery.id,
    "x-ae-signature": signWebhookBody(secret, body),
  };

  let responseCode: number | null = null;
  let snippet: string | null = null;
  let networkError: string | null = null;
  try {
    const response = await fetchImpl(delivery.endpoint.url, {
      method: "POST",
      headers,
      body,
      // No redirect following: a 3xx is not a delivery, and following
      // one could bounce the payload to a private address.
      redirect: "manual",
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseCode = response.status;
    const text = await response.text().catch(() => "");
    snippet = text.slice(0, RESPONSE_SNIPPET_CHARS);
  } catch (error) {
    networkError = error instanceof Error ? error.name : "network_error";
  }

  if (responseCode !== null && responseCode >= 200 && responseCode < 300) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "SENT",
        attempts: attempt,
        responseCode,
        responseSnippet: snippet,
        lastError: null,
        nextRetryAt: null,
      },
    });
    return { deliveredToRef: ref("sent"), status: "SENT" };
  }

  const lastError = networkError ?? `http_${responseCode ?? "none"}`;
  if (attempt >= MAX_DELIVERY_ATTEMPTS) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: "DEAD",
        attempts: attempt,
        responseCode,
        responseSnippet: snippet,
        lastError,
        nextRetryAt: null,
      },
    });
    return { deliveredToRef: ref("dead"), status: "DEAD" };
  }

  const backoff = RETRY_BACKOFF_MS[attempt - 1] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]!;
  const nextRetryAt = new Date(now().getTime() + backoff);
  const updated = await prisma.webhookDelivery.update({
    where: { id: deliveryId },
    data: {
      status: "FAILED",
      attempts: attempt,
      responseCode,
      responseSnippet: snippet,
      lastError,
      nextRetryAt,
    },
  });
  // Schedule the next attempt. If the queue is down the row still
  // says FAILED + nextRetryAt — staff can redeliver from the admin.
  await enqueue(updated, { delayMs: backoff }).catch(() => false);
  return { deliveredToRef: ref("failed"), status: "FAILED" };
}
