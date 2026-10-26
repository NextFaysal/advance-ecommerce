/**
 * GET /api/v1/public/account/b2b — the signed-in B2B buyer's company
 * dashboard (ADV-14): approval status, trade license as recorded,
 * credit limit, credit used (duePoisha as recorded), oldest due date,
 * computed available credit, plus their quotations and orders.
 * Only the session customer's own company data is ever returned.
 */
import { NextResponse } from "next/server";
import { methodNotAllowed } from "@/customer-auth/http";
import { buildB2bPortalDashboard } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "./guard";

export async function GET() {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;
  const dashboard = await buildB2bPortalDashboard(guard.customer, guard.profile);
  return NextResponse.json({
    data: dashboard,
    meta: {
      persistence: "database",
      creditUsedSource: "B2bCustomer.duePoisha (recorded)",
      availableCredit: "computed: creditLimitPoisha - duePoisha, floored at 0",
    },
  });
}

export function POST() {
  return methodNotAllowed();
}
