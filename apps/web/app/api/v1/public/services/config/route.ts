/**
 * GET /api/v1/public/services/config — the booking choices the
 * checkout can offer (ADV-23, wave 56).
 *
 * Public by design: this is display data the checkout renders
 * anyway (the same pattern as /api/v1/public/restaurant/config).
 * `enabled` is the module.services flag; `serviceVariantIds` is the
 * merchant's bookable-variant list — the checkout intersects it
 * with the cart to decide whether to show the date/slot picker.
 * The orders route re-validates every submitted booking against the
 * same config server-side, so a forged response here could not
 * smuggle an unlisted variant or an off-grid slot onto an order.
 * NOT cached: an admin edit should reach the next checkout page
 * load.
 */
import { NextResponse } from "next/server";
import { loadServicesConfig } from "@/services/config";
import { isServicesEnabled } from "@/services/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isServicesEnabled();
  if (!enabled) {
    return NextResponse.json({
      data: {
        enabled: false,
        serviceVariantIds: [],
        slotMinutes: 30,
        openTime: "09:00",
        closeTime: "21:00",
        closedWeekdays: [],
        advanceDays: 14,
      },
      meta: { db: "PRISMA", source: "SETTINGS" },
    });
  }
  const { effective } = await loadServicesConfig();
  return NextResponse.json({
    data: {
      enabled: true,
      serviceVariantIds: effective.serviceVariantIds,
      slotMinutes: effective.slotMinutes,
      openTime: effective.openTime,
      closeTime: effective.closeTime,
      closedWeekdays: effective.closedWeekdays,
      advanceDays: effective.advanceDays,
    },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
