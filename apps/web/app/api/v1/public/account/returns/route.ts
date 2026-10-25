/**
 * GET /api/v1/public/account/returns — the signed-in customer's own
 * returns (doc 17 batch O7, part 2): statuses with bilingual labels +
 * line summaries. This list is the customer-visible status surface —
 * it reflects every return change immediately, independent of the
 * queued SMS notifications (src/orders/return-notify.ts).
 */
import { NextResponse } from "next/server";
import { methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";
import { listCustomerReturns } from "@/orders/return-self-service";

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const returns = await listCustomerReturns(customer.id);
  return NextResponse.json({ data: { returns }, meta: { db: "PRISMA" } });
}

export function POST() {
  return methodNotAllowed();
}
