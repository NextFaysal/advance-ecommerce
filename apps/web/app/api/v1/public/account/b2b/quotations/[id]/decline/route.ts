/**
 * POST /api/v1/public/account/b2b/quotations/[id]/decline — the buyer
 * declines their quotation: SENT → REJECTED (the model's declined
 * state), enforced by the same transition table as the admin route.
 */
import { NextResponse } from "next/server";
import { errorResponse } from "@/customer-auth/http";
import { declineB2bQuotation } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "../../../guard";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;

  const result = await declineB2bQuotation(guard.profile, params.id);
  if (!result.ok) {
    return errorResponse(result.code, result.message, result.httpStatus, result.details);
  }
  return NextResponse.json({
    data: { quotation: result.quotation },
    meta: { persistence: "database" },
  });
}
