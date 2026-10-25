import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { bdAddressSchema } from "@/checkout/validation";
import { fulfilPreorder } from "@/orders/convert";

// PreOrder -> real order fulfilment — doc 17 batch O9-1.
// Guard mirrors the advanced-orders preorders route (orders.create).
// The service (src/orders/convert.ts) creates the order via the
// manual funnel, credits the already-paid deposit as a Payment so
// the advance engine's deposit requirement is satisfied by the
// deposit itself, and marks the PreOrder FULFILLED + linked.

const bodySchema = z.object({
  address: bdAddressSchema.optional(),
  shippingMethod: z.enum(["inside_dhaka", "outside_dhaka", "pickup"]).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid fulfil request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const result = await fulfilPreorder(
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
        orderTotalPoisha: result.orderTotalPoisha,
        depositCreditedPoisha: result.depositCreditedPoisha,
        payablePoisha: result.payablePoisha,
        advanceRequiredPoisha: result.advanceRequiredPoisha,
        advanceSatisfied: result.advanceSatisfied,
      },
      meta: { alreadyConverted: result.alreadyConverted, persistence: "database" },
    },
    { status: result.alreadyConverted ? 200 : 201 },
  );
}
