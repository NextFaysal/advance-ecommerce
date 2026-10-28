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
 * unconfigured point onto an order. Edge-cached (perf wave 2B:
 * s-maxage=300 + SWR 600): identical for every visitor; an admin
 * edit can take up to ~5 minutes to reach every visitor, which is
 * safe because orders re-resolve the point server-side.
 */
import { NextResponse } from "next/server";
import { loadPickupPoints } from "@/checkout/pickup-points";
import { catalogCacheHeaders } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const points = await loadPickupPoints();
  return NextResponse.json(
    {
      data: { points },
      meta: { db: "PRISMA", source: "SETTINGS" },
    },
    { headers: catalogCacheHeaders(300, 600) },
  );
}
