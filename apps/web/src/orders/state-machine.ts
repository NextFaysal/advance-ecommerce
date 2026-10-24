// Order state machine — the ONLY place transitions are decided.
// Invalid transitions are REJECTED, never silently coerced.
//   PENDING -> CONFIRMED -> PROCESSING -> PACKED -> SHIPPED -> DELIVERED
//   Cancellable from: PENDING, CONFIRMED, PROCESSING, PACKED
//   SHIPPED -> FAILED -> RETURNING -> RETURNED
//   DELIVERED -> RETURN_REQUESTED -> RETURNING -> RETURNED -> REFUNDED | EXCHANGED
import { publishOrderStatusChanged } from "./event-bus";
import type { Order, OrderStatus } from "./types";

export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["PACKED", "CANCELLED"],
  PACKED: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["DELIVERED", "FAILED"],
  DELIVERED: ["RETURN_REQUESTED"],
  FAILED: ["RETURNING"],
  RETURN_REQUESTED: ["RETURNING"],
  RETURNING: ["RETURNED"],
  RETURNED: ["REFUNDED", "EXCHANGED"],
  CANCELLED: [],
  REFUNDED: [],
  EXCHANGED: [],
};

export const CANCELLABLE_STATUSES: OrderStatus[] = [
  "PENDING",
  "CONFIRMED",
  "PROCESSING",
  "PACKED",
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export type TransitionResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

/**
 * Apply a transition, appending to history. On an invalid transition the
 * original order is returned unchanged with an error — the caller must surface
 * the error (toast + shake in kanban, per the dashboard spec), not proceed.
 * Sensitive transitions (CANCELLED, REFUNDED) should carry a reason; the API
 * layer (to be wired) must enforce reason-required, this pure function records it.
 */
export function transitionOrder(
  order: Order,
  to: OrderStatus,
  changedBy: string,
  reason?: string,
): TransitionResult {
  if (!canTransition(order.status, to)) {
    return {
      ok: false,
      error: `Invalid transition: ${order.status} -> ${to} is not allowed.`,
    };
  }
  if ((to === "CANCELLED" || to === "REFUNDED") && !reason?.trim()) {
    return {
      ok: false,
      error: `Reason is required for ${to}.`,
    };
  }
  const transitioned: Order = {
    ...order,
    status: to,
    history: [
      ...order.history,
      {
        from: order.status,
        to,
        changedBy,
        reason,
        changedAt: new Date().toISOString(),
      },
    ],
  };
  // order.status_changed is published ONLY here, on the success branch —
  // this function is the single funnel for every status change (admin
  // PATCH, bulk actions, one-click flow), and both rejection returns
  // above happen before this line, so a failed transition emits nothing.
  // The publish helper never throws (src/orders/event-bus), so event
  // delivery can never break a transition. Client-component callers run
  // it against browser-side mock copies; those publishes stay in the
  // browser's own bus instance and never reach the server feed.
  publishOrderStatusChanged(order, order.status, to);
  return { ok: true, order: transitioned };
}

/** The single primary "next step" button label for the order detail sticky bar. */
export function nextStepLabel(status: OrderStatus): string | null {
  switch (status) {
    case "PENDING":
      return "Confirm";
    case "CONFIRMED":
      return "Start Processing";
    case "PROCESSING":
      return "Mark Packed";
    case "PACKED":
      return "Ship";
    case "SHIPPED":
      return "Mark Delivered";
    case "DELIVERED":
      return "Request Return";
    default:
      return null;
  }
}

export function nextStepTarget(status: OrderStatus): OrderStatus | null {
  const label = nextStepLabel(status);
  if (!label) return null;
  const candidates: Record<string, OrderStatus> = {
    Confirm: "CONFIRMED",
    "Start Processing": "PROCESSING",
    "Mark Packed": "PACKED",
    Ship: "SHIPPED",
    "Mark Delivered": "DELIVERED",
    "Request Return": "RETURN_REQUESTED",
  };
  return candidates[label] ?? null;
}
