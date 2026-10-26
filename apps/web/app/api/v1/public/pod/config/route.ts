/**
 * GET /api/v1/public/pod/config — the print-on-demand choices the
 * checkout can offer (ADV-23 vertical 5, wave 56).
 *
 * Public by design: this is display data the checkout renders
 * anyway (the same pattern as /api/v1/public/rental/config).
 * `enabled` is the module.print_on_demand flag; `podVariantIds`
 * is the merchant's printable-variant list — the checkout
 * intersects it with the cart to decide whether to show the
 * print-text section — and textMaxChars / colors / printFeePoisha
 * let the section render the cap, the palette and the fee line
 * before ordering. The orders route re-validates every submitted
 * customisation against the same config server-side, so a forged
 * response here could not smuggle an unlisted variant, an
 * over-cap text or an off-palette colour onto an order.
 * `allowImageUpload` is reported for honesty: it is the
 * merchant's stored intent, but v1 has NO upload endpoint
 * (storage-gated), and the checkout offers no upload either way.
 * NOT cached: an admin edit should reach the next checkout page
 * load.
 */
import { NextResponse } from "next/server";
import { loadPodConfig } from "@/pod/config";
import { isPodEnabled } from "@/pod/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  const enabled = isPodEnabled();
  if (!enabled) {
    return NextResponse.json({
      data: {
        enabled: false,
        podVariantIds: [],
        printFeePoisha: 0,
        textMaxChars: 20,
        allowImageUpload: false,
        colors: [],
      },
      meta: { db: "PRISMA", source: "SETTINGS" },
    });
  }
  const { effective } = await loadPodConfig();
  return NextResponse.json({
    data: {
      enabled: true,
      podVariantIds: effective.podVariantIds,
      printFeePoisha: effective.printFeePoisha,
      textMaxChars: effective.textMaxChars,
      allowImageUpload: effective.allowImageUpload,
      colors: effective.colors,
    },
    meta: { db: "PRISMA", source: "SETTINGS" },
  });
}
