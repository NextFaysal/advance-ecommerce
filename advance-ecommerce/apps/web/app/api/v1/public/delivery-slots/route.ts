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
 * Edge-cached (perf wave 2B: s-maxage=300 + SWR 600): identical for
 * every visitor; an admin edit can take up to ~5 minutes to reach
 * every visitor, which is safe because orders re-resolve the slot
 * server-side.
 */
import { NextResponse } from "next/server";
import { loadDeliverySlots } from "@/checkout/delivery-slots";
import { catalogCacheHeaders } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const slots = await loadDeliverySlots();
  return NextResponse.json(
    {
      data: { slots },
      meta: { db: "PRISMA", source: "SETTINGS" },
    },
    { headers: catalogCacheHeaders(300, 600) },
  );
}
