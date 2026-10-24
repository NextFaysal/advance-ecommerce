// Partial delivery + partial payment tracking — Agent 16, Step 48 (A9).
// Hard invariant: paid (net of refunds) NEVER exceeds the order total.
// An overpayment attempt is rejected, not clamped, so staff see the mistake.
import type {
  DerivedPaymentStatus, PartialDeliveryLine, PartialPaymentState,
} from "./types";

export type PaymentResult =
  | { ok: true; state: PartialPaymentState; status: DerivedPaymentStatus }
  | { ok: false; code: "OVERPAYMENT" | "INVALID_AMOUNT" | "OVER_REFUND"; message: string };

export function derivePaymentStatus(state: PartialPaymentState): DerivedPaymentStatus {
  const net = state.paidPoisha - state.refundedPoisha;
  if (state.paidPoisha > 0 && net === 0) return "REFUNDED";
  if (state.refundedPoisha > 0 && net > 0) return "PARTIALLY_REFUNDED";
  if (net === 0) return "UNPAID";
  if (net < state.totalPoisha) return "PARTIAL";
  return "PAID";
}

export function applyPartialPayment(state: PartialPaymentState, amountPoisha: number): PaymentResult {
  if (!Number.isInteger(amountPoisha) || amountPoisha <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Payment amount must be a positive integer poisha." };
  }
  if (state.paidPoisha + amountPoisha > state.totalPoisha) {
    return {
      ok: false, code: "OVERPAYMENT",
      message: `Payment of ${amountPoisha} would exceed the order total ${state.totalPoisha} (already paid ${state.paidPoisha}).`,
    };
  }
  const next = { ...state, paidPoisha: state.paidPoisha + amountPoisha };
  return { ok: true, state: next, status: derivePaymentStatus(next) };
}

export function applyRefund(state: PartialPaymentState, amountPoisha: number): PaymentResult {
  if (!Number.isInteger(amountPoisha) || amountPoisha <= 0) {
    return { ok: false, code: "INVALID_AMOUNT", message: "Refund amount must be a positive integer poisha." };
  }
  if (state.refundedPoisha + amountPoisha > state.paidPoisha) {
    return { ok: false, code: "OVER_REFUND", message: "Refund cannot exceed the amount actually paid." };
  }
  const next = { ...state, refundedPoisha: state.refundedPoisha + amountPoisha };
  return { ok: true, state: next, status: derivePaymentStatus(next) };
}

export function duePoisha(state: PartialPaymentState): number {
  return Math.max(0, state.totalPoisha - (state.paidPoisha - state.refundedPoisha));
}

export type DeliveryProgress = {
  lines: PartialDeliveryLine[];
  totalOrdered: number;
  totalDelivered: number;
  fullyDelivered: boolean;
};

/** Record a partial delivery against order lines. Over-delivery is rejected. */
export function applyPartialDelivery(
  lines: readonly PartialDeliveryLine[],
  variantId: string,
  qty: number,
): { ok: true; progress: DeliveryProgress } | { ok: false; message: string } {
  if (!Number.isInteger(qty) || qty <= 0) return { ok: false, message: "Delivery qty must be a positive integer." };
  const target = lines.find((l) => l.variantId === variantId);
  if (!target) return { ok: false, message: `No order line for variant ${variantId}.` };
  if (target.deliveredQty + qty > target.orderedQty) {
    return { ok: false, message: "Cannot deliver more than ordered." };
  }
  const next = lines.map((l) =>
    l.variantId === variantId ? { ...l, deliveredQty: l.deliveredQty + qty } : { ...l });
  const totalOrdered = next.reduce((s, l) => s + l.orderedQty, 0);
  const totalDelivered = next.reduce((s, l) => s + l.deliveredQty, 0);
  return {
    ok: true,
    progress: { lines: next, totalOrdered, totalDelivered, fullyDelivered: totalDelivered === totalOrdered },
  };
}
