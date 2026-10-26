/**
 * GET /api/v1/public/pickup-points — the click & collect pickup
 * points the checkout can offer, from Settings stores.pickup_points
 * via src/checkout/pickup-points (EMPTY list when the merchant has
 * configured none — the loader fails open and there are deliberately
 * no built-in store addresses).
 *
 * Public by design: the response is display data the storefront shows
 * anyway (name/address/hours, also rendered on /stores). The choice
 * never affects pricing, and the orders route re-resolves a submitted
 * id server-side, so a forged list here could not smuggle an
 * unconfigured point onto an order. NOT cached: an admin edit should
 * reach the next checkout page load.
 */
import { NextResponse } from "next/server";
import { loadPickupPoints } from "@/checkout/pickup-points";

export const dynamic = "force-dynamic";

export async function GET() {
  const points = await loadPickupPoints();
  return NextResponse.json({
    data: { points },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
