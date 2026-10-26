/**
 * GET /api/v1/public/account/b2b/products — the B2B portal price
 * list: ACTIVE live catalogue variants priced for THIS buyer by the
 * group-pricing resolver (override > group discount > catalogue,
 * src/b2b/group-pricing.ts). Behind module.b2b_portal via the shared
 * portal guard; only the session buyer's own group applies.
 */
import { NextResponse } from "next/server";
import { methodNotAllowed } from "@/customer-auth/http";
import { listB2bPortalPriceList } from "@/b2b/group-pricing";
import { requireB2bPortalCustomer } from "../guard";

export async function GET() {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;
  const priceList = await listB2bPortalPriceList(guard.profile.id);
  return NextResponse.json({
    data: priceList,
    meta: {
      persistence: "database",
      pricing: "group override > group discountBps > catalogue price (integer poisha)",
    },
  });
}

export function POST() {
  return methodNotAllowed();
}
