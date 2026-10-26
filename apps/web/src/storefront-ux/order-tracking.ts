/**
 * Public order tracking — Part B. Pure logic.
 *
 * PRIVACY RULES (this is a public, unauthenticated surface):
 * - The customer must prove BOTH the order number AND the phone used on
 *   the order. Phone comparison happens on NORMALIZED numbers only.
 * - Order-not-found and phone-mismatch return the SAME generic error, so
 *   the endpoint cannot be used to enumerate which order numbers exist.
 * - The response only ever carries the MASKED phone.
 * - Callers must rate-limit by IP (shared Redis limiter:
 *   src/lib/rate-limit.ts).
 *
 * SHIPMENT DATA (doc 21 G3-20): when the caller supplies the order's
 * real Shipment rows (see src/shipments/tracking.ts), the view carries
 * one parcel per row — courier, tracking code and the real
 * ShipmentEvent timeline — and `shipmentSource` is "shipments". With
 * no rows the view falls back to the order-status-derived summary and
 * `shipmentSource` is "order-status", so the UI can label it as an
 * order-step estimate instead of live courier data. Nothing in the
 * fallback invents a courier, a tracking code or an event.
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

/** Display names for the courier provider keys stored on Shipment rows
 *  (Shipment.provider is the lowercase adapter key; Order.courier, the
 *  legacy column, already carries a display name). Unknown keys are
 *  shown verbatim — the stored value is the truth either way. */
export const COURIER_DISPLAY_NAMES: Record<string, string> = {
  steadfast: "Steadfast",
  pathao: "Pathao",
  redx: "RedX",
  paperfly: "Paperfly",
  ecourier: "eCourier",
};

export function courierDisplayName(provider: string): string {
  return COURIER_DISPLAY_NAMES[provider.toLowerCase()] ?? provider;
}

/* ------------------------------------------------------------------ */
/* Real shipment rows, as read by src/shipments/tracking.ts. Plain     */
/* serializable data — this module stays pure; the DB read (and the    */
/* split line-item name resolution) happens in the shipments slice.    */
/* ------------------------------------------------------------------ */

export interface TrackingShipmentEventRow {
  status: ShipmentStatus;
  /** ISO instant the courier event occurred (ShipmentEvent.occurredAt). */
  occurredAt: string;
  location: string | null;
}

export interface TrackingShipmentRow {
  id: string;
  /** Courier provider key as stored (e.g. "steadfast"). */
  provider: string;
  /** Consignment / tracking code from the booking, null until issued. */
  trackingId: string | null;
  status: ShipmentStatus;
  /** ISO booking instant (Shipment.createdAt). */
  createdAt: string;
  /** Real courier events, oldest first. Empty when none recorded yet. */
  events: TrackingShipmentEventRow[];
  /** The order lines this parcel carries, resolved to names by the
   *  reader. null = the booking covers the whole order (unsplit);
   *  an empty array never occurs (unresolvable lines are dropped by
   *  the reader and a fully-unresolvable split reads as null). */
  items: Array<{ productName: string; quantity: number }> | null;
}

export interface TrackingParcelEvent {
  status: ShipmentStatus;
  labelBn: string;
  at: string;
  location: string | null;
}

export interface TrackingParcel {
  /** Courier display name (e.g. "Steadfast"). */
  courier: string;
  trackingId: string | null;
  status: ShipmentStatus;
  statusLabelBn: string;
  events: TrackingParcelEvent[];
  items: Array<{ productName: string; quantity: number }> | null;
}

/** Map real Shipment rows to the customer-facing per-parcel view. */
export function buildParcels(rows: readonly TrackingShipmentRow[]): TrackingParcel[] {
  return rows.map((row) => ({
    courier: courierDisplayName(row.provider),
    trackingId: row.trackingId,
    status: row.status,
    statusLabelBn: SHIPMENT_STATUS_LABELS_BN[row.status],
    events: row.events.map((e) => ({
      status: e.status,
      labelBn: SHIPMENT_STATUS_LABELS_BN[e.status],
      at: e.occurredAt,
      location: e.location,
    })),
    items: row.items,
  }));
}

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
  /** Real per-parcel data, one entry per Shipment row (split shipments
   *  appear as separate parcels). Empty when the order has no Shipment
   *  rows — the courier/trackingId/shipmentStatus fields above then
   *  carry the order-status-derived fallback instead. */
  parcels: TrackingParcel[];
  /** Where the shipment section came from: "shipments" = real Shipment
   *  rows + events; "order-status" = derived from the order's own
   *  status (no live courier data yet). The UI labels the fallback. */
  shipmentSource: "shipments" | "order-status";
  timeline: TrackingTimelineStep[];
  createdAt: string;
}

/** Derive a courier-side status from the order status — the FALLBACK
 *  summary used only when the order has no real Shipment rows. */
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

export function lookupTracking(
  orders: Order[],
  orderNoInput: string,
  phoneInput: string,
  shipments: readonly TrackingShipmentRow[] = [],
): TrackingLookupResult {
  const fail: TrackingLookupResult = { ok: false, error: "not_found", messageBn: GENERIC_NOT_FOUND };
  const normalized = normalizeBdPhone(phoneInput);
  if (!normalized) return fail;
  const orderNo = orderNoInput.trim().toUpperCase();
  const order = orders.find((o) => o.orderNo.toUpperCase() === orderNo);
  if (!order) return fail;
  // Stored phones are normalized at checkout; compare normalized-to-normalized.
  if (normalizeBdPhone(order.customerPhone) !== normalized) return fail;
  const parcels = buildParcels(shipments);
  if (parcels.length > 0) {
    // Real Shipment rows win. The legacy single-parcel summary fields
    // are filled only when there is exactly ONE parcel — with several,
    // any single courier/status would misrepresent the others, so the
    // per-parcel sections carry the truth on their own.
    const single = parcels.length === 1 ? parcels[0] : null;
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
        courier: single ? single.courier : null,
        trackingId: single ? single.trackingId : null,
        shipmentStatus: single ? single.status : null,
        shipmentStatusLabelBn: single ? single.statusLabelBn : null,
        parcels,
        shipmentSource: "shipments",
        timeline: buildTimeline(order),
        createdAt: order.createdAt,
      },
    };
  }
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
      parcels,
      shipmentSource: "order-status",
      timeline: buildTimeline(order),
      createdAt: order.createdAt,
    },
  };
}
