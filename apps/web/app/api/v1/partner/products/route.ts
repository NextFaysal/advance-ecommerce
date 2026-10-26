import { NextResponse } from "next/server";
import { listPartnerProducts, requirePartnerScope } from "@/webhooks/partner";

// Partner API — products (ADV-26). Bearer API key with the
// products:read scope. Same shape as the admin product list minus
// cost/PII: variant costPoisha is never selected, so it can never
// appear here.
export async function GET(req: Request) {
  const guard = await requirePartnerScope(req, "products:read");
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const products = await listPartnerProducts(limit);
  return NextResponse.json({
    data: { products },
    meta: { scope: "products:read", note: "Cost fields are excluded from the partner surface." },
  });
}
