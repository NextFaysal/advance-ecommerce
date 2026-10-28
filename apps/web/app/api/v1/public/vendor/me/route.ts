import { cookies } from "next/headers";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { NextResponse } from "next/server";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import { buildVendorPortalDashboard } from "@/vendors/portal";

// Vendor portal "me" (ADV-13) — the signed-in vendor's dashboard:
// shop info + KYC state, own products (stock as recorded), orders
// containing their products (customer phone MASKED), the commission
// ledger and the payout summary — all from real rows.
export const dynamic = "force-dynamic";

export async function GET() {
  await ensureDbFeatureFlags().catch(() => {});
  if (!isVendorPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
      { status: 403 },
    );
  }
  const store = await cookies();
  const vendorId = await verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value);
  if (!vendorId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  const dashboard = await buildVendorPortalDashboard(vendorId);
  if (!dashboard) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: dashboard, meta: { persistence: "database" } });
}
