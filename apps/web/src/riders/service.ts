// Rider COD reconciliation, payout and performance — Agent 18 (E3). Pure.
// Money integer poisha; rates in basis points so no float ever represents
// money or a rate in storage/output.
import { maskPhone } from "../checkout/validation";
import type { CodHandoverLine, Rider, RiderDelivery, RiderPerformance, RiderView } from "./types";

/** API-safe view: the stored phone never leaves the server unmasked here. */
export function toRiderView(rider: Rider): RiderView {
  const { phone, ...rest } = rider;
  return { ...rest, phoneMasked: maskPhone(phone) };
}

/** Payout for one delivery: the flat per-delivery rate, DELIVERED only. */
export function deliveryPayoutPoisha(rider: Rider, delivery: RiderDelivery): number {
  return delivery.status === "DELIVERED" ? rider.payoutPerDeliveryPoisha : 0;
}

/**
 * COD handover line for one delivery. Expected = what the customer was
 * supposed to pay; collected = what the rider took; handedOver = what the
 * rider gave the shop. Shortage is expected - handedOver (only meaningful
 * after handover) and is FLAGGED, never silently adjusted — the accountant
 * workflow resolves it, exactly like courier reconciliation (src/bd).
 */
export function codHandoverLine(delivery: RiderDelivery): CodHandoverLine {
  const collectedPoisha = delivery.codCollectedPoisha ?? 0;
  const handedOver = delivery.codHandedOverPoisha !== undefined;
  const handedOverPoisha = delivery.codHandedOverPoisha ?? 0;
  const shortagePoisha = handedOver ? delivery.codAmountPoisha - handedOverPoisha : 0;
  return {
    deliveryId: delivery.id,
    orderId: delivery.orderId,
    expectedPoisha: delivery.codAmountPoisha,
    collectedPoisha,
    handedOverPoisha,
    shortagePoisha,
    hasShortage: handedOver && shortagePoisha > 0,
    handedOver,
  };
}

/**
 * Record a shift-end handover against a delivery. Returns a NEW delivery.
 * Handing over MORE than expected is rejected (it means another order's
 * cash is being mixed in — record it separately, never net it off here).
 */
export function recordCodHandover(delivery: RiderDelivery, handedOverPoisha: number): RiderDelivery {
  if (!Number.isInteger(handedOverPoisha) || handedOverPoisha < 0) {
    throw new Error("Handed-over amount must be a non-negative integer poisha.");
  }
  if (delivery.status !== "DELIVERED") {
    throw new Error("COD handover is only recorded for DELIVERED deliveries.");
  }
  if (handedOverPoisha > delivery.codAmountPoisha) {
    throw new Error("Handed-over amount cannot exceed the expected COD for this delivery.");
  }
  return { ...delivery, codHandedOverPoisha: handedOverPoisha };
}

function bps(numerator: number, denominator: number, fallback: number): number {
  if (denominator <= 0) return fallback;
  return Math.floor((numerator * 10000) / denominator);
}

/** Performance over a set of deliveries for one rider. */
export function computeRiderPerformance(rider: Rider, deliveries: readonly RiderDelivery[]): RiderPerformance {
  const mine = deliveries.filter((d) => d.riderId === rider.id);
  const delivered = mine.filter((d) => d.status === "DELIVERED");
  const failed = mine.filter((d) => d.status === "FAILED");
  const completed = delivered.length + failed.length;
  const codExpectedPoisha = delivered.reduce((s, d) => s + d.codAmountPoisha, 0);
  const codCollectedPoisha = delivered.reduce((s, d) => s + (d.codCollectedPoisha ?? 0), 0);
  return {
    riderId: rider.id,
    totalAssigned: mine.length,
    delivered: delivered.length,
    failed: failed.length,
    inFlight: mine.length - completed,
    // No completed run yet => 0 (unknown), not 100%: never inflate a new rider.
    successRateBps: bps(delivered.length, completed, 0),
    codExpectedPoisha,
    codCollectedPoisha,
    // Nothing expected (all prepaid) => perfect accuracy by definition.
    codAccuracyBps: bps(codCollectedPoisha, codExpectedPoisha, 10000),
    payoutPoisha: delivered.reduce((s, d) => s + deliveryPayoutPoisha(rider, d), 0),
  };
}
