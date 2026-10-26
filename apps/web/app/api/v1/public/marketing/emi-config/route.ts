import { NextResponse } from "next/server";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { loadEmiConfig, toPublicEmiConfig, computeEmiBreakdown, EMI_DISABLED } from "@/marketing/emi";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/public/marketing/emi-config[?total=<poisha>]
 * The display-only EMI configuration for client surfaces (checkout
 * note). With ?total= the server also returns the computed
 * breakdowns so no pricing math ever ships to (or runs in) the
 * client. Values are presentation data; nothing here changes any
 * charged amount.
 */
export async function GET(req: Request) {
  if (!marketingMechanicsEnabled()) {
    return NextResponse.json({ data: { config: toPublicEmiConfig(EMI_DISABLED), breakdowns: [] }, meta: { feature: "off" } });
  }
  const config = await loadEmiConfig();
  const totalRaw = new URL(req.url).searchParams.get("total");
  const total = totalRaw === null ? 0 : Number.parseInt(totalRaw, 10);
  const breakdowns = Number.isFinite(total) && total > 0 ? computeEmiBreakdown(total, config) : [];
  return NextResponse.json({
    data: { config: toPublicEmiConfig(config), breakdowns },
    meta: { displayOnly: true },
  });
}
