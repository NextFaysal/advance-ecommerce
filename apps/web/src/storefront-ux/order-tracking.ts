/**
 * Public order tracking — Part B. Pure logic.
 *
 * PRIVACY RULES (this is a public, unauthenticated surface):
 * - The customer must prove BOTH the order number AND the phone used on
 *   the order. Phone comparison happens on NORMALIZED numbers only.
 * - Order-not-found and phone-mismatch return the SAME generic error, so
 *   the endpoint cannot be used to enumerate which order numbers exist.
 * - The response only ever carries the MASKED phone.
 * - Callers must rate-limit by IP (see FixedWindowRateLimiter below; the
 *   production version swaps its store for Redis with the same shape).
 */
import { maskPhone, normalizeBdPhone } from "@advance-ecommerce/validators";
import type { Order, OrderStatus } from "@/orders/types";
import type { ShipmentStatus } from "@/integrations/courier";

export const ORDER_STATUS_LABELS_BN: Record<OrderStatus, string> = {
  PENDING: "অর্ডার পেয়েছি",
  CONFIRMED: "কনফার্ম হয়েছে",
  PROCESSING: "প্রসেসিং চলছে",
  PACKED: "প্যাক করা হয়েছে",
  SHIPPED: "পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারি হয়েছে",
  FAILED: "ডেলিভারি ব্যর্থ হয়েছে",
  RETURN_REQUESTED: "রিটার্নের অনুরোধ এসেছে",
  RETURNING: "রিটার্ন ফেরত আসছে",
  RETURNED: "রিটার্ন পৌঁছেছে",
  CANCELLED: "বাতিল হয়েছে",
  REFUNDED: "রিফান্ড হয়েছে",
  EXCHANGED: "বদলি পাঠানো হয়েছে",
};

export const SHIPMENT_STATUS_LABELS_BN: Record<ShipmentStatus, string> = {
  CREATED: "কুরিয়ার বুকিং তৈরি হয়েছে",
  PICKED_UP: "কুরিয়ার পিক আপ করেছে",
  IN_TRANSIT: "পথে আছে",
  OUT_FOR_DELIVERY: "ডেলিভারির জন্য বের হয়েছে",
  DELIVERED: "ডেলিভারি হয়েছে",
  FAILED: "ডেলিভারি ব্যর্থ",
  RETURNING: "ফেরত আসছে",
  RETURNED: "ফেরত এসেছে",
};

/** Main happy-path flow shown as the tracking progress timeline. */
const MAIN_FLOW: OrderStatus[] = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"];

export interface TrackingTimelineStep {
  status: OrderStatus;
  labelBn: string;
  state: "done" | "current" | "upcoming" | "problem";
  /** ISO time the order entered this status (from history), null if not reached. */
  at: string | null;
}

export interface TrackingView {
  orderNo: string;
  status: OrderStatus;
  statusLabelBn: string;
  maskedPhone: string;
  items: Array<{ productName: string; quantity: number; unitPricePoisha: number }>;
  totalPoisha: number;
  paymentMethod: string;
  paymentStatus: string;
  courier: string | null;
  trackingId: string | null;
  shipmentStatus: ShipmentStatus | null;
  shipmentStatusLabelBn: string | null;
  timeline: TrackingTimelineStep[];
  createdAt: string;
}

/** Derive a courier-side status from the order status (until real Shipment rows are wired). */
export function deriveShipmentStatus(order: Order): ShipmentStatus | null {
  if (!order.trackingId && order.status !== "SHIPPED" && order.status !== "DELIVERED") return null;
  switch (order.status) {
    case "SHIPPED":
      return "IN_TRANSIT";
    case "DELIVERED":
      return "DELIVERED";
    case "FAILED":
      return "FAILED";
    case "RETURNING":
      return "RETURNING";
    case "RETURNED":
      return "RETURNED";
    default:
      return order.trackingId ? "CREATED" : null;
  }
}

export function buildTimeline(order: Order): TrackingTimelineStep[] {
  const enteredAt = new Map<OrderStatus, string>();
  for (const h of order.history) {
    if (!enteredAt.has(h.to)) enteredAt.set(h.to, h.changedAt);
  }
  const offPath = !MAIN_FLOW.includes(order.status);
  return MAIN_FLOW.map((status) => {
    const at = enteredAt.get(status) ?? null;
    let state: TrackingTimelineStep["state"];
    if (offPath) {
      state = at ? "done" : "upcoming";
    } else if (status === order.status) {
      state = "current";
    } else {
      state = at ? "done" : "upcoming";
    }
    return { status, labelBn: ORDER_STATUS_LABELS_BN[status], state, at };
  });
}

export type TrackingLookupResult =
  | { ok: true; view: TrackingView }
  | { ok: false; error: "not_found"; messageBn: string };

const GENERIC_NOT_FOUND = "অর্ডার পাওয়া যায়নি — অর্ডার নম্বর ও মোবাইল নম্বর মিলিয়ে আবার চেষ্টা করুন।";

export function lookupTracking(orders: Order[], orderNoInput: string, phoneInput: string): TrackingLookupResult {
  const fail: TrackingLookupResult = { ok: false, error: "not_found", messageBn: GENERIC_NOT_FOUND };
  const normalized = normalizeBdPhone(phoneInput);
  if (!normalized) return fail;
  const orderNo = orderNoInput.trim().toUpperCase();
  const order = orders.find((o) => o.orderNo.toUpperCase() === orderNo);
  if (!order) return fail;
  // Stored phones are normalized at checkout; compare normalized-to-normalized.
  if (normalizeBdPhone(order.customerPhone) !== normalized) return fail;
  const shipmentStatus = deriveShipmentStatus(order);
  return {
    ok: true,
    view: {
      orderNo: order.orderNo,
      status: order.status,
      statusLabelBn: ORDER_STATUS_LABELS_BN[order.status],
      maskedPhone: maskPhone(normalized),
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPricePoisha: i.unitPricePoisha })),
      totalPoisha: order.totalPoisha,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      courier: order.courier ?? null,
      trackingId: order.trackingId ?? null,
      shipmentStatus,
      shipmentStatusLabelBn: shipmentStatus ? SHIPMENT_STATUS_LABELS_BN[shipmentStatus] : null,
      timeline: buildTimeline(order),
      createdAt: order.createdAt,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Fixed-window rate limiter — in-memory demo. Production: Redis with  */
/* the same check(key) contract (see jobs/queues + QA-CHECKLIST Step 34).*/
/* ------------------------------------------------------------------ */

export class FixedWindowRateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxRequests: number = 10,
    private readonly windowMs: number = 5 * 60_000,
  ) {}

  check(key: string, now: Date = new Date()): { allowed: boolean; retryAfterSeconds: number } {
    const t = now.getTime();
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count > this.maxRequests) {
      return { allowed: false, retryAfterSeconds: Math.ceil((entry.windowStart + this.windowMs - t) / 1000) };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

/** Shared limiter for the public tracking endpoint: 10 lookups / 5 min / IP. */
export const trackingRateLimiter = new FixedWindowRateLimiter(10, 5 * 60_000);
