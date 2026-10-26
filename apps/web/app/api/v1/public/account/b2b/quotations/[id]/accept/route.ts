/**
 * POST /api/v1/public/account/b2b/quotations/[id]/accept — the buyer
 * accepts their SENT quotation. The portal flips SENT → ACCEPTED and
 * then calls the wave-27 conversion service (src/orders/convert.ts)
 * unchanged: the order is created at the quotation's contract prices
 * and the credit rules answer with their own 409s
 * (CREDIT_LIMIT_EXCEEDED / CREDIT_OVERDUE / CUSTOMER_NOT_APPROVED).
 * Body mirrors the admin convert route: optional delivery address +
 * shipping method; without an address the service falls back to the
 * customer's saved / last-order address, else 422 ADDRESS_REQUIRED.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requestMeta } from "@/customer-auth/http";
import { bdAddressSchema } from "@/checkout/validation";
import { acceptB2bQuotation } from "@/b2b/portal";
import { requireB2bPortalCustomer } from "../../../guard";

const bodySchema = z.object({
  address: bdAddressSchema.optional(),
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireB2bPortalCustomer();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "Invalid accept request.", 400, parsed.error.issues);
  }

  const result = await acceptB2bQuotation(
    guard.customer,
    guard.profile,
    params.id,
    parsed.data,
    requestMeta(req),
  );
  if (!result.ok) {
    return errorResponse(result.code, result.message, result.httpStatus, result.details);
  }
  return NextResponse.json(
    {
      data: {
        orderId: result.orderId,
        orderNo: result.orderNo,
        quotationTotalPoisha: result.quotationTotalPoisha,
        outstandingPoisha: result.outstandingPoisha,
        creditLimitPoisha: result.creditLimitPoisha,
      },
      meta: { alreadyConverted: result.alreadyConverted ?? false, persistence: "database" },
    },
    { status: result.httpStatus },
  );
}
