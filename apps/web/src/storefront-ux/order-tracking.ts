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
import { pick, type Locale } from "@/i18n/locale";
import {
  KITCHEN_STATUS_LABELS_BN,
  KITCHEN_STATUS_LABELS_EN,
  type KitchenTicketStatus,
} from "@/restaurant/selection";

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

export const ORDER_STATUS_LABELS_EN: Record<OrderStatus, string> = {
  PENDING: "Order received",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURN_REQUESTED: "Return requested",
  RETURNING: "Return on its way",
  RETURNED: "Return received",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  EXCHANGED: "Exchange sent",
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

export const SHIPMENT_STATUS_LABELS_EN: Record<ShipmentStatus, string> = {
  CREATED: "Courier booking created",
  PICKED_UP: "Picked up by courier",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURNING: "Being returned",
  RETURNED: "Returned",
};

/** Doc 30: locale-keyed label records — pick(locale, …) selects the set. */
export const ORDER_STATUS_LABELS: Record<Locale, Record<OrderStatus, string>> = {
  bn: ORDER_STATUS_LABELS_BN,
  en: ORDER_STATUS_LABELS_EN,
};

export const SHIPMENT_STATUS_LABELS: Record<Locale, Record<ShipmentStatus, string>> = {
  bn: SHIPMENT_STATUS_LABELS_BN,
  en: SHIPMENT_STATUS_LABELS_EN,
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

/** Map real Shipment rows to the customer-facing per-parcel view.
 *  The `*LabelBn` fields carry the label in `locale` (doc 30; the field
 *  names are kept for compatibility with existing consumers). */
export function buildParcels(rows: readonly TrackingShipmentRow[], locale: Locale = "bn"): TrackingParcel[] {
  const labels = pick(locale, SHIPMENT_STATUS_LABELS);
  return rows.map((row) => ({
    courier: courierDisplayName(row.provider),
    trackingId: row.trackingId,
    status: row.status,
    statusLabelBn: labels[row.status],
    events: row.events.map((e) => ({
      status: e.status,
      labelBn: labels[e.status],
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
  /** Restaurant kitchen state (ADV-23, wave 56): present only when
   *  the order has a KitchenTicket row. Projected server-side to
   *  status + fulfilment + table — the customer watches their food,
   *  nothing about other orders or kitchen internals is included. */
  kitchen: {
    status: string;
    statusLabelBn: string;
    fulfilmentType: "DINE_IN" | "TAKEAWAY";
    tableLabel: string | null;
  } | null;
  /** Merchant workflow stage (ADV-26, BUILD-LITE): a friendly step
   *  label the merchant anchored at the order's CURRENT canonical
   *  status ("quality check"), shown under the canonical status —
   *  the canonical status above it is unchanged and stays the truth
   *  for every money/stock decision. Present only when a stage is
   *  set and the module is ON (resolved server-side, past the phone
   *  check, same no-leak discipline as the kitchen projection). */
  workflowStage: {
    labelBn: string;
    labelEn: string;
  } | null;
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

export function buildTimeline(order: Order, locale: Locale = "bn"): TrackingTimelineStep[] {
  const labels = pick(locale, ORDER_STATUS_LABELS);
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
    return { status, labelBn: labels[status], state, at };
  });
}

export type TrackingLookupResult =
  | { ok: true; view: TrackingView }
  | { ok: false; error: "not_found"; messageBn: string; message: string };

const GENERIC_NOT_FOUND: Record<Locale, string> = {
  bn: "অর্ডার পাওয়া যায়নি — অর্ডার নম্বর ও মোবাইল নম্বর মিলিয়ে আবার চেষ্টা করুন।",
  en: "Order not found — check the order number and mobile number and try again.",
};

export function lookupTracking(
  orders: Order[],
  orderNoInput: string,
  phoneInput: string,
  shipments: readonly TrackingShipmentRow[] = [],
  kitchen: {
    status: string;
    fulfilmentType: "DINE_IN" | "TAKEAWAY";
    tableLabel: string | null;
  } | null = null,
  workflowStage: {
    labelBn: string;
    labelEn: string;
  } | null = null,
  /** Doc 30: label language for the whole view (default bn = legacy). */
  locale: Locale = "bn",
): TrackingLookupResult {
  const orderLabels = pick(locale, ORDER_STATUS_LABELS);
  const shipmentLabels = pick(locale, SHIPMENT_STATUS_LABELS);
  const fail: TrackingLookupResult = {
    ok: false,
    error: "not_found",
    messageBn: GENERIC_NOT_FOUND.bn,
    message: pick(locale, GENERIC_NOT_FOUND),
  };
  const normalized = normalizeBdPhone(phoneInput);
  if (!normalized) return fail;
  const orderNo = orderNoInput.trim().toUpperCase();
  const order = orders.find((o) => o.orderNo.toUpperCase() === orderNo);
  if (!order) return fail;
  // Stored phones are normalized at checkout; compare normalized-to-normalized.
  if (normalizeBdPhone(order.customerPhone) !== normalized) return fail;
  // The kitchen projection is attached ONLY past the phone check —
  // like the shipments above, a mismatch leaks nothing about it.
  const kitchenView = kitchen
    ? {
        status: kitchen.status,
        statusLabelBn:
          pick(locale, { bn: KITCHEN_STATUS_LABELS_BN, en: KITCHEN_STATUS_LABELS_EN })[
            kitchen.status as KitchenTicketStatus
          ] ?? kitchen.status,
        fulfilmentType: kitchen.fulfilmentType,
        tableLabel: kitchen.tableLabel,
      }
    : null;
  const parcels = buildParcels(shipments, locale);
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
        statusLabelBn: orderLabels[order.status],
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
        kitchen: kitchenView,
        workflowStage,
        timeline: buildTimeline(order, locale),
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
      statusLabelBn: orderLabels[order.status],
      maskedPhone: maskPhone(normalized),
      items: order.items.map((i) => ({ productName: i.productName, quantity: i.quantity, unitPricePoisha: i.unitPricePoisha })),
      totalPoisha: order.totalPoisha,
      paymentMethod: order.paymentMethod,
      paymentStatus: order.paymentStatus,
      courier: order.courier ?? null,
      trackingId: order.trackingId ?? null,
      shipmentStatus,
      shipmentStatusLabelBn: shipmentStatus ? shipmentLabels[shipmentStatus] : null,
      parcels,
      shipmentSource: "order-status",
      kitchen: kitchenView,
      workflowStage,
      timeline: buildTimeline(order, locale),
      createdAt: order.createdAt,
    },
  };
}
