import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isResellerPortalEnabled } from "@/reseller/flags";
import { RESELLER_SESSION_COOKIE, verifyResellerSessionToken } from "@/reseller/portal-auth";
import { buildPortalDashboard } from "@/reseller/portal";

// Reseller portal "me" (ADV-12) — the signed-in reseller's dashboard:
// code + referral link, tier + progress, attributed orders (customer
// phone MASKED), commission ledger, payout balances + requests.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isResellerPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Reseller portal is locked for this install (module.reseller_portal is OFF)." } },
      { status: 403 },
    );
  }
  const store = await cookies();
  const resellerId = verifyResellerSessionToken(store.get(RESELLER_SESSION_COOKIE)?.value);
  if (!resellerId) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  const dashboard = await buildPortalDashboard(resellerId);
  if (!dashboard) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "আগে লগইন করুন।" } },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: dashboard, meta: { persistence: "database" } });
}
