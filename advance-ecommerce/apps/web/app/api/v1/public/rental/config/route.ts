/**
 * GET /api/v1/public/rental/config — the rental choices the
 * checkout can offer (ADV-23 vertical 3, wave 56).
 *
 * Public by design: this is display data the checkout renders
 * anyway (the same pattern as /api/v1/public/services/config).
 * `enabled` is the module.rental flag; `rentalVariantIds` is the
 * merchant's rentable-variant list — the checkout intersects it
 * with the cart to decide whether to show the date-range picker —
 * and the deposit settings let the picker show the deposit line
 * before ordering. The orders route re-validates every submitted
 * rental against the same config server-side (and recomputes the
 * deposit from the SERVER price), so a forged response here could
 * not smuggle an unlisted variant, an over-long window or a
 * cheaper deposit onto an order. Edge-cached (perf wave 2B:
 * s-maxage=300 + SWR 600): identical for every visitor; an admin
 * edit can take up to ~5 minutes to reach every visitor, which is
 * safe because orders re-validate every rental server-side.
 */
import { NextResponse } from "next/server";
import { loadRentalConfig } from "@/rental/config";
import { isRentalEnabled } from "@/rental/flags";
import { catalogCacheHeaders } from "@/lib/http-cache";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isRentalEnabled();
  if (!enabled) {
    return NextResponse.json(
      {
        data: {
          enabled: false,
          rentalVariantIds: [],
          maxRentalDays: 30,
          depositMode: "none",
          depositFixedPoisha: 0,
          depositPercentBps: 0,
        },
        meta: { db: "PRISMA", source: "SETTINGS" },
      },
      { headers: catalogCacheHeaders(300, 600) },
    );
  }
  const { effective } = await loadRentalConfig();
  return NextResponse.json(
    {
      data: {
        enabled: true,
        rentalVariantIds: effective.rentalVariantIds,
        maxRentalDays: effective.maxRentalDays,
        depositMode: effective.depositMode,
        depositFixedPoisha: effective.depositFixedPoisha,
        depositPercentBps: effective.depositPercentBps,
      },
      meta: { db: "PRISMA", source: "SETTINGS" },
    },
    { headers: catalogCacheHeaders(300, 600) },
  );
}
