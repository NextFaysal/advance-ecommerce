/**
 * Public-tracking shipment read (doc 21 G3-20).
 *
 * The /track lookup used to derive a "shipment status" from the ORDER
 * status and never touched the Shipment table. This is the real read:
 * the order's Shipment rows (soft-deleted excluded, oldest booking
 * first) with their ShipmentEvent history — the rows the booking flow
 * and the courier webhook / order-sync actually wrote. Event order is
 * by occurredAt (the courier's instant), ties by insertion order.
 * Nothing here is synthesized: a booking with no events returns an
 * empty event list, and the caller falls back to the order-status view
 * ONLY when there are no Shipment rows at all.
 *
 * Split shipments: Shipment.lineItemsJson allocations are resolved to
 * product names through the order's OrderItem rows (the domain Order
 * type carries no item ids, so the resolution lives here, next to the
 * query). lineItemsJson === null means the parcel carries the whole
 * order and `items` stays null; unresolvable allocation ids are
 * dropped, and a split whose lines all fail to resolve reads as null
 * rather than as an empty parcel.
 *
 * Read-only, and only ever called AFTER the route has loaded the
 * order — the phone-match gate in lookupTracking still decides what
 * the caller sees, so fetching these rows cannot leak existence.
 */
import { prisma } from "@advance-ecommerce/db";
import type { ShipmentStatus } from "@/integrations/courier";
import type { TrackingShipmentRow } from "@/storefront-ux/order-tracking";
import { parseAllocations } from "./split-shipments";

export async function getTrackingShipmentsForOrder(orderId: string): Promise<TrackingShipmentRow[]> {
  const rows = await prisma.shipment.findMany({
    where: { orderId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    include: {
      events: {
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        select: { status: true, occurredAt: true, location: true },
      },
    },
  });
  if (rows.length === 0) return [];

  // Resolve split allocations to product names in one extra query,
  // and only when at least one booking is actually split.
  const needsItems = rows.some((r) => r.lineItemsJson !== null);
  const nameByItemId = new Map<string, string>();
  if (needsItems) {
    const items = await prisma.orderItem.findMany({
      where: { orderId },
      select: { id: true, productName: true },
    });
    for (const item of items) nameByItemId.set(item.id, item.productName);
  }

  return rows.map((r) => {
    let items: TrackingShipmentRow["items"] = null;
    if (r.lineItemsJson !== null) {
      const resolved = parseAllocations(r.lineItemsJson)
        .map((a) => {
          const productName = nameByItemId.get(a.orderItemId);
          return productName === undefined ? null : { productName, quantity: a.quantity };
        })
        .filter((x): x is { productName: string; quantity: number } => x !== null);
      items = resolved.length > 0 ? resolved : null;
    }
    return {
      id: r.id,
      provider: r.provider,
      trackingId: r.trackingId,
      status: r.status as ShipmentStatus,
      createdAt: r.createdAt.toISOString(),
      events: r.events.map((e) => ({
        status: e.status as ShipmentStatus,
        occurredAt: e.occurredAt.toISOString(),
        location: e.location,
      })),
      items,
    };
  });
}
