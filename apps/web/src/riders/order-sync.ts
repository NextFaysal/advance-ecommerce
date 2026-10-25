/**
 * Rider delivery -> order sync — doc 17, batch O5 (part 2).
 *
 * Until this module the own-rider flow recorded deliveries in
 * isolation: completing a RiderDelivery never touched the linked
 * Order. The PATCH /api/v1/admin/riders/deliveries route now calls
 * `syncRiderDeliveryToOrder` after every successful transition to
 * DELIVERED or FAILED:
 *
 *  - DELIVERED -> the shared courier seam
 *    (transitionOrderForCourierEvent, provider "rider") moves the
 *    order to DELIVERED through the transition funnel. COD collection:
 *    the rider flow DOES track collection — applyDeliveryTransition
 *    stores collectedPoisha on the delivery (defaulting to the
 *    expected codAmountPoisha when the request omits it) — so that
 *    recorded amount is passed for COD orders. Prepaid orders pass no
 *    collection. The eventId is deterministic per delivery
 *    (`rider-delivery:<id>`), and the seam dedupes COD recording by
 *    that marker, so a replayed sync can never double-record cash.
 *  - FAILED -> note only, never a status change: a failed attempt
 *    (couldn't pick up, or customer unavailable) is not a return. The
 *    rider vocabulary has no terminal "returned to hub" state —
 *    FAILED is terminal for the delivery row, and staff reassign by
 *    creating a fresh delivery — so nothing maps to RETURNED here.
 *  - Split-shipment guard: if the order carries split bookings
 *    (Shipment.lineItemsJson) that are not fully delivered yet, a
 *    rider completion must not deliver the whole order either — a
 *    partial-delivery note is written and the order is moved to (or
 *    kept at) SHIPPED via the seam.
 *
 * Surfacing: there is no spare field on RiderDelivery for a sync flag
 * (failureReason belongs to the delivery outcome itself), so sync
 * outcomes surface on the ORDER timeline — the seam writes its own
 * bilingual note for every refusal (cancelled / still PENDING / no
 * legal path), and this module notes the partial-delivery case.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  recordCourierEventNote,
  transitionOrderForCourierEvent,
  type CourierSyncResult,
} from "@/courier/order-sync";
import { isOrderFullyDelivered, orderHasSplitShipments } from "@/shipments/split-shipments";
import type { RiderDelivery } from "./types";

const RIDER_PROVIDER = "rider";

function riderEventId(delivery: RiderDelivery): string {
  return `rider-delivery:${delivery.id}`;
}

/**
 * Record a rider delivery failure on the order's timeline. Note only —
 * the order status is deliberately NOT changed for a failed attempt.
 */
export async function recordRiderFailureNoteOnOrder(delivery: RiderDelivery): Promise<void> {
  const reason = delivery.failureReason?.trim() || "no reason recorded";
  await recordCourierEventNote(
    delivery.orderId,
    { provider: RIDER_PROVIDER, eventId: riderEventId(delivery) },
    `রাইডার ডেলিভারি সম্পন্ন হয়নি (ডেলিভারি ${delivery.id}, রাইডার ${delivery.riderId}): ${reason} — অর্ডারের অবস্থা বদলানো হয়নি; প্রয়োজনে নতুন করে অ্যাসাইন করুন। / Rider delivery was not completed (delivery ${delivery.id}, rider ${delivery.riderId}): ${reason} — the order status was NOT changed; reassign if needed.`,
  );
}

/**
 * Sync a terminal rider-delivery outcome (DELIVERED or FAILED) to its
 * order. Safe to call more than once for the same delivery: status
 * moves are funnel-idempotent and COD recording is deduped by the
 * seam's per-event marker.
 */
export async function syncRiderDeliveryToOrder(delivery: RiderDelivery): Promise<CourierSyncResult> {
  if (delivery.status === "FAILED") {
    await recordRiderFailureNoteOnOrder(delivery);
    return { applied: false, reason: "rider_failed_noted" };
  }
  if (delivery.status !== "DELIVERED") {
    return { applied: false, reason: "not_terminal" };
  }

  const order = await prisma.order.findFirst({
    where: { id: delivery.orderId, deletedAt: null },
    select: { id: true, paymentMethod: true },
  });
  if (!order) return { applied: false, reason: "order_not_found" };

  // Partial-delivery rule: split bookings exist and are not all
  // delivered — a rider completion cannot finish the whole order.
  if ((await orderHasSplitShipments(order.id)) && !(await isOrderFullyDelivered(order.id))) {
    await recordCourierEventNote(
      order.id,
      { provider: RIDER_PROVIDER, eventId: riderEventId(delivery) },
      `আংশিক ডেলিভারি: রাইডার ডেলিভারি ${delivery.id} সম্পন্ন হয়েছে, তবে এই অর্ডারের বিভক্ত শিপমেন্টগুলোর সব লাইন এখনো ডেলিভার্ড হয়নি — অর্ডার SHIPPED অবস্থাতেই থাকল। / Partial delivery: rider delivery ${delivery.id} completed, but not every line of this order's split shipments is delivered yet — the order stays SHIPPED.`,
    );
    return transitionOrderForCourierEvent(order.id, "SHIPPED", {
      provider: RIDER_PROVIDER,
      eventId: riderEventId(delivery),
      note: `Rider delivery ${delivery.id} completed (partial — split shipments outstanding).`,
    });
  }

  const codCollectedPoisha =
    order.paymentMethod === "COD" ? (delivery.codCollectedPoisha ?? delivery.codAmountPoisha) : undefined;
  return transitionOrderForCourierEvent(order.id, "DELIVERED", {
    provider: RIDER_PROVIDER,
    eventId: riderEventId(delivery),
    codCollectedPoisha,
    note: `Rider delivery ${delivery.id} completed by rider ${delivery.riderId}.`,
  });
}
