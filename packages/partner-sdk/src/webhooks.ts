/**
 * Webhook receiver helpers — verifying and parsing the signed
 * webhooks the platform sends to your endpoint.
 *
 * The signing scheme (server side: `apps/web/src/webhooks/deliver.ts`):
 *
 *   X-AE-Signature: hex( HMAC-SHA256( endpointSecret, rawBody ) )
 *   X-AE-Event:     the event name, e.g. "order.created"
 *   X-AE-Delivery:  the delivery id (same as the payload's `id`)
 *
 * The signature covers the EXACT raw body bytes — always verify
 * against the unparsed request body, never a re-serialised object.
 * The comparison here is constant-time. Verification uses the Web
 * Crypto API (`crypto.subtle`), available in Node.js 18+, browsers,
 * and edge runtimes — no dependencies.
 *
 * Delivery semantics worth knowing: a delivery counts as sent only
 * on a 2xx from your endpoint; failures retry after 1m / 10m / 1h /
 * 6h and are DEAD after 5 attempts. Because of retries, the same
 * event can arrive more than once — dedupe on the payload `id`
 * (equivalently, the `X-AE-Delivery` header).
 */

export const WEBHOOK_SIGNATURE_HEADER = "x-ae-signature";
export const WEBHOOK_EVENT_HEADER = "x-ae-event";
export const WEBHOOK_DELIVERY_HEADER = "x-ae-delivery";

/** The subscribable event catalogue (mirrors the server registry). */
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

/**
 * The payload envelope. `data` is deliberately privacy-minimal —
 * ids, statuses, and totals only; never a full phone, address,
 * email, or name. If the entity vanished between the event and
 * dispatch, `data` carries just `{ id }`.
 */
export interface WebhookEvent<TData = Record<string, unknown>> {
  /** The delivery id — dedupe on this. */
  id: string;
  event: WebhookEventName;
  /** ISO 8601 — when the delivery was created. */
  createdAt: string;
  data: TData;
}

/** `data` for order.created / order.status_changed / payment.succeeded. */
export interface WebhookOrderData {
  id: string;
  orderNo?: string;
  status?: string;
  paymentStatus?: string;
  totalPoisha?: number;
  itemCount?: number;
  createdAt?: string;
}

/** `data` for stock.low. */
export interface WebhookStockData {
  variantId: string;
  productId?: string;
  sku?: string;
  available?: number;
}

/** `data` for checkout.abandoned. */
export interface WebhookAbandonedCheckoutData {
  id: string;
  subtotalPoisha?: number;
  itemCount?: number;
  status?: string;
  createdAt?: string;
}

/** `data` for customer.registered. */
export interface WebhookCustomerData {
  customerId: string;
  registeredAt?: string;
}

export class WebhookParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookParseError";
  }
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Constant-time string comparison (lengths are not secret here). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verify an `X-AE-Signature` header against the raw request body.
 *
 * @param rawBody         the exact request body string, unparsed
 * @param signatureHeader the `x-ae-signature` header value (hex)
 * @param secret          the endpoint's signing secret (shown once
 *                        when the endpoint is created in admin)
 * @returns true only when the signature matches
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader || !secret) return false;
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      "verifyWebhookSignature requires Web Crypto (crypto.subtle) — Node.js 18+, a browser, or an edge runtime.",
    );
  }
  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await subtle.sign("HMAC", key, encoder.encode(rawBody));
  return timingSafeEqual(toHex(mac), signatureHeader.trim().toLowerCase());
}

/**
 * Parse and shape-check a raw webhook body. Throws WebhookParseError
 * on invalid JSON, a missing envelope field, or an event name the
 * platform does not emit. Verify the signature BEFORE trusting the
 * result — this function checks shape only, not authenticity.
 */
export function parseWebhookEvent(rawBody: string): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new WebhookParseError("Webhook body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new WebhookParseError("Webhook body is not a JSON object.");
  }
  const { id, event, createdAt, data } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || id === "") {
    throw new WebhookParseError("Webhook payload is missing its delivery `id`.");
  }
  if (typeof event !== "string" || !isWebhookEventName(event)) {
    throw new WebhookParseError(`Unknown webhook event: ${String(event)}`);
  }
  if (typeof createdAt !== "string" || createdAt === "") {
    throw new WebhookParseError("Webhook payload is missing `createdAt`.");
  }
  if (typeof data !== "object" || data === null) {
    throw new WebhookParseError("Webhook payload is missing its `data` object.");
  }
  return { id, event, createdAt, data: data as Record<string, unknown> };
}
