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
 * order. NOT cached: an admin edit should reach the next checkout
 * page load.
 */
import { NextResponse } from "next/server";
import { loadRestaurantConfig } from "@/restaurant/config";
import { isRestaurantEnabled } from "@/restaurant/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isRestaurantEnabled();
  if (!enabled) {
    return NextResponse.json({
      data: { enabled: false, dineInEnabled: false, takeawayEnabled: false, tables: [] },
      meta: { db: "PRISMA", source: "SETTINGS" },
    });
  }
  const { effective } = await loadRestaurantConfig();
  return NextResponse.json({
    data: {
      enabled: true,
      dineInEnabled: effective.dineInEnabled,
      takeawayEnabled: effective.takeawayEnabled,
      tables: effective.dineInEnabled ? effective.tables : [],
    },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
