import { NextResponse } from "next/server";
import { getPublicExitIntent } from "@/marketing/campaign-templates";

// Public exit-intent config for the storefront popup. Returns
// data:null unless the module flag is on AND the popup is enabled;
// the coupon code is included only while the Coupon row genuinely
// validates (re-checked server-side per request — an expired code
// never reaches the browser). no-store: config edits must take
// effect on the next page load, never behind an edge cache.
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getPublicExitIntent().catch(() => null);
  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
