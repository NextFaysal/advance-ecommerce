import { NextResponse } from "next/server";
import { listPartnerOrders, requirePartnerScope } from "@/webhooks/partner";

// Partner API — orders (ADV-26). Bearer API key with the orders:read
// scope. Phones are masked, names/addresses/emails are not part of
// this surface at all.
export async function GET(req: Request) {
  const guard = await requirePartnerScope(req, "orders:read");
  if (!guard.ok) return guard.response;
  const url = new URL(req.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const orders = await listPartnerOrders(limit);
  return NextResponse.json({
    data: { orders },
    meta: { scope: "orders:read", note: "Customer phones are masked; names and addresses are excluded." },
  });
}
