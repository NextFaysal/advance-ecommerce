/**
 * GET /api/v1/public/delivery-slots — the delivery time bands the
 * checkout (and the admin manual builder) can offer, from Settings
 * orders.delivery_slots via src/checkout/delivery-slots (BD defaults
 * when unset/malformed — the loader fails open).
 *
 * Public by design: the response is display labels only (no prices,
 * no secrets) — the slot choice never affects pricing, and the
 * orders routes re-resolve a submitted id server-side, so a forged
 * list here could not smuggle an unconfigured slot onto an order.
 * NOT cached: an admin edit should reach the next checkout page load.
 */
import { NextResponse } from "next/server";
import { loadDeliverySlots } from "@/checkout/delivery-slots";

export const dynamic = "force-dynamic";

export async function GET() {
  const slots = await loadDeliverySlots();
  return NextResponse.json({
    data: { slots },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
