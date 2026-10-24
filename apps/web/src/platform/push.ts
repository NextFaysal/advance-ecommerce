/**
 * Web Push — base types, payload builder, trigger map (Agent 37).
 *
 * The sender in THIS module is the sandbox one: it records intent in
 * memory and performs NO network call. The REAL sender (RFC 8291
 * encryption + VAPID, keys from server env) and the subscription
 * persistence live in src/platform/push-server.ts (2026-10-25) — use
 * sendWebPush / sendPushToCustomer there for production sends; this
 * module stays the source of the payload templates and types both
 * senders share.
 *
 * Subscription `keys` below are the browser-issued Web Push subscription
 * keys (p256dh/auth). They identify a subscription; they are stored
 * server-side when subscriptions are persisted, and must never be logged
 * or returned to other clients.
 */
import type { OrderStatus } from "../orders/types";

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

export interface PushSubscriptionRecord {
  /** Push service endpoint URL issued by the browser. */
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  /** Store customer this subscription belongs to, when known. */
  customerId?: string;
  userAgent?: string;
  createdAt: string; // ISO timestamp
}

export function validatePushSubscription(input: unknown): { ok: true; value: PushSubscriptionRecord } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const obj = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const endpoint = typeof obj.endpoint === "string" ? obj.endpoint : "";
  if (!endpoint.startsWith("https://")) errors.push("endpoint must be an https URL");
  const keys = (typeof obj.keys === "object" && obj.keys !== null ? obj.keys : {}) as Record<string, unknown>;
  if (typeof keys.p256dh !== "string" || keys.p256dh.length === 0) errors.push("keys.p256dh is required");
  if (typeof keys.auth !== "string" || keys.auth.length === 0) errors.push("keys.auth is required");
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      endpoint,
      keys: { p256dh: keys.p256dh as string, auth: keys.auth as string },
      customerId: typeof obj.customerId === "string" ? obj.customerId : undefined,
      userAgent: typeof obj.userAgent === "string" ? obj.userAgent : undefined,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : new Date().toISOString(),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Templates + payload builder (Bangla-first)                          */
/* ------------------------------------------------------------------ */

export const PUSH_TEMPLATE_KEYS = [
  "order_confirmed",
  "order_shipped",
  "order_out_for_delivery",
  "order_delivered",
  "delivery_failed",
  "order_cancelled",
  "return_requested",
  "order_refunded",
  "abandoned_cart_reminder",
  "back_in_stock",
] as const;

export type PushTemplateKey = (typeof PUSH_TEMPLATE_KEYS)[number];

interface PushTemplate {
  titleBn: string;
  bodyBn: string;
  /** Path template; {orderId} is filled from vars when present. */
  urlTemplate: string;
}

/** {placeholders} are filled from PushTemplateVars; unknown ones stay as-is. */
export const PUSH_TEMPLATES: Record<PushTemplateKey, PushTemplate> = {
  order_confirmed: {
    titleBn: "অর্ডার নিশ্চিত হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo} নিশ্চিত হয়েছে। আমরা শীঘ্রই প্যাকিং শুরু করব।",
    urlTemplate: "/track",
  },
  order_shipped: {
    titleBn: "অর্ডার পাঠানো হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo} কুরিয়ারে দেওয়া হয়েছে। ট্র্যাকিং: {trackingId}",
    urlTemplate: "/track",
  },
  order_out_for_delivery: {
    titleBn: "অর্ডার ডেলিভারির পথে",
    bodyBn: "আপনার অর্ডার #{orderNo} আজ ডেলিভারি হবে। অনুগ্রহ করে ফোনের কাছে থাকুন।",
    urlTemplate: "/track",
  },
  order_delivered: {
    titleBn: "অর্ডার ডেলিভারি সম্পন্ন",
    bodyBn: "আপনার অর্ডার #{orderNo} ডেলিভারি হয়েছে। কেনাকাটার জন্য ধন্যবাদ!",
    urlTemplate: "/track",
  },
  delivery_failed: {
    titleBn: "ডেলিভারি ব্যর্থ হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo} ডেলিভারি করা যায়নি। আমরা আবার চেষ্টা করব অথবা কল করব।",
    urlTemplate: "/track",
  },
  order_cancelled: {
    titleBn: "অর্ডার বাতিল হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo} বাতিল করা হয়েছে। প্রশ্ন থাকলে আমাদের সাথে যোগাযোগ করুন।",
    urlTemplate: "/track",
  },
  return_requested: {
    titleBn: "রিটার্ন অনুরোধ গৃহীত হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo}-এর রিটার্ন অনুরোধ পেয়েছি। পরবর্তী ধাপ শীঘ্রই জানানো হবে।",
    urlTemplate: "/track",
  },
  order_refunded: {
    titleBn: "রিফান্ড দেওয়া হয়েছে",
    bodyBn: "আপনার অর্ডার #{orderNo}-এর রিফান্ড প্রক্রিয়া সম্পন্ন হয়েছে।",
    urlTemplate: "/track",
  },
  abandoned_cart_reminder: {
    titleBn: "কার্টে পণ্য অপেক্ষা করছে",
    bodyBn: "আপনি কার্টে কিছু পণ্য রেখে গেছেন। স্টক শেষ হওয়ার আগেই অর্ডার সম্পন্ন করুন।",
    urlTemplate: "/cart",
  },
  back_in_stock: {
    titleBn: "পণ্য আবার স্টকে এসেছে",
    bodyBn: "আপনার পছন্দের পণ্য {productName} আবার স্টকে এসেছে।",
    urlTemplate: "/shop",
  },
};

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  icon: string;
  tag?: string;
}

export type PushTemplateVars = Record<string, string>;

const DEFAULT_ICON = "/icons/icon-192.png";

function fill(template: string, vars: PushTemplateVars): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => vars[key] ?? match);
}

export function buildPushPayload(
  templateKey: PushTemplateKey,
  vars: PushTemplateVars = {},
  overrides: Partial<PushPayload> = {},
): PushPayload {
  const template = PUSH_TEMPLATES[templateKey];
  return {
    title: overrides.title ?? fill(template.titleBn, vars),
    body: overrides.body ?? fill(template.bodyBn, vars),
    url: overrides.url ?? template.urlTemplate,
    icon: overrides.icon ?? DEFAULT_ICON,
    tag: overrides.tag ?? templateKey,
  };
}

/* ------------------------------------------------------------------ */
/* Event triggers: order status -> customer push template              */
/* ------------------------------------------------------------------ */

/** Statuses with no customer push map to null (no notification). */
export const ORDER_STATUS_PUSH_TEMPLATES: Record<OrderStatus, PushTemplateKey | null> = {
  PENDING: null,
  CONFIRMED: "order_confirmed",
  PROCESSING: null,
  PACKED: null,
  SHIPPED: "order_shipped",
  DELIVERED: "order_delivered",
  FAILED: "delivery_failed",
  RETURN_REQUESTED: "return_requested",
  RETURNING: null,
  RETURNED: null,
  CANCELLED: "order_cancelled",
  REFUNDED: "order_refunded",
  EXCHANGED: null,
};

export function pushTemplateForOrderStatus(status: OrderStatus): PushTemplateKey | null {
  return ORDER_STATUS_PUSH_TEMPLATES[status];
}

/* ------------------------------------------------------------------ */
/* Sender — sandbox / no-op only                                       */
/* ------------------------------------------------------------------ */

export interface PushSendIntent {
  endpoint: string;
  payload: PushPayload;
  recordedAt: string;
}

export interface PushSendResult {
  ok: boolean;
  /** "sandbox-noop" until a real Web Push sender is wired. */
  mode: "sandbox-noop";
  delivered: false;
  note: string;
}

export interface PushSender {
  send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<PushSendResult>;
}

/**
 * Records send intent in memory and returns WITHOUT any network call.
 * Swap for a real Web Push implementation (VAPID keys from encrypted
 * admin settings, server-side only) behind this same interface.
 */
export class SandboxPushSender implements PushSender {
  readonly intents: PushSendIntent[] = [];

  async send(subscription: PushSubscriptionRecord, payload: PushPayload): Promise<PushSendResult> {
    this.intents.push({ endpoint: subscription.endpoint, payload, recordedAt: new Date().toISOString() });
    return {
      ok: true,
      mode: "sandbox-noop",
      delivered: false,
      note: "Sandbox sender: intent recorded in memory only; no push was sent and no network call was made.",
    };
  }
}

/** Shared sandbox instance for this process (demo wiring only). */
export const sandboxPushSender = new SandboxPushSender();
