/**
 * GET /api/v1/public/account/b2b/quotations — the buyer's own
 * quotations (newest first) with lines, totals and effective status
 * (a SENT/DRAFT quotation past validUntil reads as EXPIRED).
 */
import { NextResponse } from "next/server";
import { methodNotAllowed } from "@/customer-auth/http";
import { listB2bPortalQuotations } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "../guard";

export async function GET() {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;
  const quotations = await listB2bPortalQuotations(guard.profile);
  return NextResponse.json({
    data: { quotations },
    meta: { persistence: "database" },
  });
}

export function POST() {
  return methodNotAllowed();
}
