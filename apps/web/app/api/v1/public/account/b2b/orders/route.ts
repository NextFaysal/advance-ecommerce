/**
 * GET /api/v1/public/account/b2b/orders — the buyer company's orders
 * (the session customer's orders) with per-order payment/due state
 * computed from real Payment / Refund rows. Quotation-converted
 * credit orders carry source "b2b" and are flagged as such.
 */
import { NextResponse } from "next/server";
import { methodNotAllowed } from "@/customer-auth/http";
import { listB2bPortalOrders } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "../guard";

export async function GET() {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;
  const orders = await listB2bPortalOrders(guard.customer.id);
  return NextResponse.json({
    data: { orders },
    meta: {
      persistence: "database",
      due: "computed per order: total - payments + money-moved refunds; 0 for CANCELLED/REFUNDED",
    },
  });
}

export function POST() {
  return methodNotAllowed();
}
