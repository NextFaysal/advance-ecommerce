/**
 * GET /api/v1/public/restaurant/config — the restaurant fulfilment
 * choices the checkout can offer (ADV-23, wave 56).
 *
 * Public by design: this is display data the checkout renders
 * anyway (the same pattern as pickup-points / gift-cards status).
 * `enabled` is the module.restaurant flag; dineInEnabled is the
 * EFFECTIVE value (false until the merchant configures at least
 * one table). The orders route re-validates every submitted
 * selection against the same config server-side, so a forged
 * response here could not smuggle an unconfigured table onto an
 * order. Edge-cached (perf wave 2B: s-maxage=300 + SWR 600):
 * identical for every visitor; an admin edit can take up to
 * ~5 minutes to reach every visitor, which is safe because orders
 * re-validate every selection server-side.
 */
import { NextResponse } from "next/server";
import { loadRestaurantConfig } from "@/restaurant/config";
import { isRestaurantEnabled } from "@/restaurant/flags";
import { catalogCacheHeaders } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isRestaurantEnabled();
  if (!enabled) {
    return NextResponse.json(
      {
        data: { enabled: false, dineInEnabled: false, takeawayEnabled: false, tables: [] },
        meta: { db: "PRISMA", source: "SETTINGS" },
      },
      { headers: catalogCacheHeaders(300, 600) },
    );
  }
  const { effective } = await loadRestaurantConfig();
  return NextResponse.json(
    {
      data: {
        enabled: true,
        dineInEnabled: effective.dineInEnabled,
        takeawayEnabled: effective.takeawayEnabled,
        tables: effective.dineInEnabled ? effective.tables : [],
      },
      meta: { db: "PRISMA", source: "SETTINGS" },
    },
    { headers: catalogCacheHeaders(300, 600) },
  );
}
