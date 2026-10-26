// Raw provider status -> internal status mapping — Agent 9.
// A provider's raw vocabulary is translated HERE, nowhere else, so the
// rest of the system only ever sees ShipmentStatus / PaymentStatus.
// Unknown raw values are rejected (not coerced to a guessed status).
import type { PaymentStatus } from "../payment";
import type { ShipmentStatus } from "../courier";
import { canTransition } from "../../orders/state-machine";
import type { OrderStatus } from "../../orders/types";

const STEADFAST_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  delivered_approval_pending: "OUT_FOR_DELIVERY",
  partial_delivered_approval_pending: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  cancelled: "FAILED",
  hold: "IN_TRANSIT",
  in_review: "IN_TRANSIT",
  unknown_approval_pending: "IN_TRANSIT",
};

const PATHAO_MAP: Record<string, ShipmentStatus> = {
  order_placed: "CREATED",
  assigned: "PICKED_UP",
  picked: "PICKED_UP",
  in_transit: "IN_TRANSIT",
  delivering: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  on_hold: "FAILED",
  return_in_transit: "RETURNING",
  returned: "RETURNED",
};

const REDX_MAP: Record<string, ShipmentStatus> = {
  pickup_pending: "CREATED",
  picked_up: "PICKED_UP",
  received_at_hub: "IN_TRANSIT",
  in_transit: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  delivery_failed: "FAILED",
  returning: "RETURNING",
  returned: "RETURNED",
};

// Wave 51: paperfly/ecourier have live adapters but no sandbox
// provider — these maps exist so a sandbox-branch webhook for them
// resolves statuses honestly instead of silently no-oping; booking a
// paperfly/ecourier parcel still requires the live adapter (the
// shipments route returns 422 when unconfigured).
const PAPERFLY_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED", order_placed: "CREATED", picked_up: "PICKED_UP",
  in_transit: "IN_TRANSIT", hold: "IN_TRANSIT", out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED", partial_delivered: "DELIVERED", delivery_failed: "FAILED",
  cancelled: "FAILED", returning: "RETURNING", returned: "RETURNED",
};

const ECOURIER_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED", order_placed: "CREATED", picked_up: "PICKED_UP",
  in_transit: "IN_TRANSIT", in_progress: "IN_TRANSIT", hold: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY", delivered: "DELIVERED",
  partial_delivered: "DELIVERED", delivery_failed: "FAILED",
  cancelled: "FAILED", returning: "RETURNING", returned: "RETURNED",
};

const COURIER_MAPS: Record<string, Record<string, ShipmentStatus>> = {
  steadfast: STEADFAST_MAP,
  pathao: PATHAO_MAP,
  redx: REDX_MAP,
  paperfly: PAPERFLY_MAP,
  ecourier: ECOURIER_MAP,
};

export function mapCourierRawStatus(provider: string, rawStatus: string): ShipmentStatus | null {
  const map = COURIER_MAPS[provider];
  if (!map) return null;
  return map[rawStatus.trim().toLowerCase()] ?? null;
}

/** Shipment movement that the sandbox treats as forward progress. */
const SHIPMENT_FLOW: ShipmentStatus[] = [
  "CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
];

/**
 * Apply a mapped shipment status in the sandbox: forward progress,
 * FAILED, RETURNING and RETURNED are allowed; going backwards on the
 * forward flow (e.g. DELIVERED -> IN_TRANSIT) is rejected, never coerced.
 */
export function canApplyShipmentStatus(from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (from === to) return true;
  if (to === "FAILED" || to === "RETURNING" || to === "RETURNED") {
    return from !== "DELIVERED" || to !== "FAILED";
  }
  const fromIdx = SHIPMENT_FLOW.indexOf(from);
  const toIdx = SHIPMENT_FLOW.indexOf(to);
  return fromIdx >= 0 && toIdx > fromIdx;
}

/** ShipmentStatus -> the OrderStatus it should move the order to, if any. */
export const SHIPMENT_TO_ORDER_STATUS: Partial<Record<ShipmentStatus, OrderStatus>> = {
  PICKED_UP: "SHIPPED",
  IN_TRANSIT: "SHIPPED",
  OUT_FOR_DELIVERY: "SHIPPED",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  RETURNING: "RETURNING",
  RETURNED: "RETURNED",
};

/**
 * Move an order status only through the order state machine
 * (orders/state-machine.ts canTransition). If the direct transition is
 * not legal from the current order status, the order is left unchanged
 * and applied:false is returned — the webhook is still logged by the caller.
 */
export function applyShipmentToOrderStatus(
  current: OrderStatus,
  shipmentStatus: ShipmentStatus,
): { applied: boolean; next: OrderStatus; reason: string | null } {
  const target = SHIPMENT_TO_ORDER_STATUS[shipmentStatus];
  if (target === undefined || target === current) {
    return { applied: target !== undefined, next: current, reason: target === undefined ? "no_order_mapping" : null };
  }
  if (!canTransition(current, target)) {
    return { applied: false, next: current, reason: `invalid_order_transition:${current}->${target}` };
  }
  return { applied: true, next: target, reason: null };
}

const PAYMENT_MAPS: Record<string, Record<string, PaymentStatus>> = {
  bkash: { completed: "PAID", success: "PAID", initiated: "UNPAID", failed: "FAILED", cancelled: "FAILED", refunded: "REFUNDED" },
  nagad: { success: "PAID", pending: "UNPAID", failed: "FAILED", cancelled: "FAILED", refunded: "REFUNDED" },
  sslcommerz: { valid: "PAID", validated: "PAID", failed: "FAILED", cancelled: "FAILED", refunded: "REFUNDED" },
};

export function mapPaymentRawStatus(provider: string, rawStatus: string): PaymentStatus | null {
  const map = PAYMENT_MAPS[provider];
  if (!map) return null;
  return map[rawStatus.trim().toLowerCase()] ?? null;
}
