import { NextResponse } from "next/server";
import { listPartnerCustomers, requirePartnerScope } from "@/webhooks/partner";

// Partner API — customers (ADV-26, doc 23 wave 53). Bearer API key
// with the customers:read scope (the scope has been grantable since
// wave 43; this is its first endpoint). Phones are masked; credential
// and social-binding fields are never selected at the DB layer.
export async function GET(req: Request) {
  const guard = await requirePartnerScope(req, "customers:read");
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const customers = await listPartnerCustomers(limit);
  return NextResponse.json({
    data: { customers },
    meta: {
      scope: "customers:read",
      note: "Customer phones are masked. Lifetime stats count every recorded order for the customer, regardless of status.",
    },
  });
}
