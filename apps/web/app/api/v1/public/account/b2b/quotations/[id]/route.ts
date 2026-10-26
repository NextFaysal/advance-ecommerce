/**
 * GET /api/v1/public/account/b2b/quotations/[id] — one of the buyer's
 * own quotations with full lines/totals. Another B2B account's
 * quotation id answers 404 (ownership is part of the lookup).
 */
import { NextResponse } from "next/server";
import { errorResponse, methodNotAllowed } from "@/customer-auth/http";
import { getB2bPortalQuotation } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "../../guard";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;
  const quotation = await getB2bPortalQuotation(guard.profile, params.id);
  if (quotation === null) {
    return errorResponse("QUOTATION_NOT_FOUND", "কোটেশন পাওয়া যায়নি। / Quotation not found.", 404);
  }
  return NextResponse.json({
    data: { quotation },
    meta: { persistence: "database" },
  });
}

export function POST() {
  return methodNotAllowed();
}
