import { NextResponse } from "next/server";
import { z } from "zod";
import { b2bGuardError, requireB2bAdmin } from "@/b2b/guard";
import { bdAddressSchema } from "@/checkout/validation";
import { convertQuotation } from "@/orders/convert";

// B2B quotation -> real order conversion — doc 17 batch O9-1.
// Guard: the B2B module's own guard (module.b2b flag + b2b.manage),
// the same one every other B2B route uses. Credit enforcement lives
// in the service (src/orders/convert.ts): CREDIT_LIMIT_EXCEEDED /
// CREDIT_OVERDUE refusals carry the three credit numbers in details.

const bodySchema = z.object({
  address: bdAddressSchema.optional(),
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireB2bAdmin("b2b.manage");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid convert request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const result = await convertQuotation(
    params.id,
    { id: guard.userId, permissions: guard.permissions },
    parsed.data,
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message, details: result.details } },
      { status: result.httpStatus },
    );
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
      meta: { alreadyConverted: result.alreadyConverted, persistence: "database" },
    },
    { status: result.alreadyConverted ? 200 : 201 },
  );
}
