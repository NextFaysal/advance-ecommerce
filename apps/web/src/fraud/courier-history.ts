/**
 * Courier outcome history for fraud scoring — ADV-7 (doc 22, G3
 * leftover "advance-engine risk inputs").
 *
 * src/fraud/scoring.ts has carried a courier_success_rate signal
 * since the fraud batch (needs >= 3 bookings: success rate < 50%
 * scores +30, 50-69% scores +15), but nothing ever supplied the input
 * — assembleFraudInput's header honestly recorded "no courier outcome
 * data exists at checkout time". Real Shipment rows now exist
 * (storefront + admin booking write them, courier webhooks advance
 * their status), so the signal has a data source: this loader counts
 * one customer's booked parcels from their orders' shipments.
 *
 * Definitions (deliberately conservative):
 *  - A BOOKING is a shipment that actually entered the courier
 *    pipeline: PICKED_UP / IN_TRANSIT / OUT_FOR_DELIVERY / DELIVERED /
 *    FAILED / RETURNING / RETURNED. A shipment still in CREATED never
 *    left the shop and says nothing about the customer.
 *  - DELIVERED counts only the DELIVERED status. FAILED / RETURNED
 *    parcels count against the rate — a customer whose parcels keep
 *    coming back is exactly the pattern this signal exists for.
 *
 * Failure discipline: this feeds a checkout-time scoring path, so it
 * must never break checkout — any DB error resolves to `undefined`
 * (the signal simply does not fire, exactly as before this loader
 * existed).
 */
import { prisma } from "@advance-ecommerce/db";

const BOOKED_STATUSES = [
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURNING",
  "RETURNED",
] as const;

export async function loadCourierHistoryForPhone(
  phone: string,
): Promise<{ totalBookings: number; delivered: number; failedOrReturned: number } | undefined> {
  try {
    const rows = await prisma.shipment.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        status: { in: [...BOOKED_STATUSES] },
        order: { customerPhone: phone, deletedAt: null },
      },
      _count: { _all: true },
    });
    let totalBookings = 0;
    let delivered = 0;
    let failedOrReturned = 0;
    for (const row of rows) {
      totalBookings += row._count._all;
      if (row.status === "DELIVERED") delivered += row._count._all;
      if (row.status === "FAILED" || row.status === "RETURNED" || row.status === "RETURNING") {
        failedOrReturned += row._count._all;
      }
    }
    if (totalBookings === 0) return undefined;
    return { totalBookings, delivered, failedOrReturned };
  } catch {
    return undefined;
  }
}
