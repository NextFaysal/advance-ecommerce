import { NextResponse } from "next/server";
import { z } from "zod";
import { b2bGuardError, requireB2bAdmin } from "@/b2b/guard";
import { demoB2bStore } from "@/b2b/store";
import { approvalTransition, checkCredit } from "@/b2b/service";
import { maskPhone } from "@/checkout/validation";

// B2B customers — Agent 16. GET: approval queue + credit state (phones
// masked). PATCH: approval transition (PENDING->APPROVED/REJECTED,
// APPROVED->SUSPENDED, SUSPENDED->APPROVED/REJECTED, REJECTED->PENDING).
// POST: credit check for a proposed order total. Demo persistence, labelled.

export async function GET() {
  const guard = await requireB2bAdmin("b2b.view");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const today = new Date().toISOString().slice(0, 10);
  const customers = demoB2bStore.listCustomers().map((c) => ({
    ...c,
    phone: maskPhone(c.phone),
    overdue: Boolean(c.oldestDueDate && c.oldestDueDate < today && c.outstandingPoisha > 0),
    availableCreditPoisha: Math.max(0, c.creditLimitPoisha - c.outstandingPoisha),
  }));
  return NextResponse.json({ data: { customers }, meta: { persistence: "in-memory-demo" } });
}

const approvalSchema = z.object({
  customerId: z.string().min(1),
  to: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED"]),
});

export async function PATCH(req: Request) {
  const guard = await requireB2bAdmin("b2b.manage");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = approvalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid approval change.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const customer = demoB2bStore.getCustomer(parsed.data.customerId);
  if (!customer) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "B2B customer not found." } }, { status: 404 });
  }
  if (!approvalTransition(customer.approvalStatus, parsed.data.to)) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSITION", message: `Approval cannot move ${customer.approvalStatus} -> ${parsed.data.to}.` } },
      { status: 422 },
    );
  }
  const updated = { ...customer, approvalStatus: parsed.data.to };
  demoB2bStore.replaceCustomer(updated);
  return NextResponse.json({
    data: { customer: { ...updated, phone: maskPhone(updated.phone) } },
    meta: { persistence: "in-memory-demo" },
  });
}

const creditCheckSchema = z.object({
  customerId: z.string().min(1),
  orderTotalPoisha: z.number().int().nonnegative(),
});

export async function POST(req: Request) {
  const guard = await requireB2bAdmin("b2b.view");
  if (!guard.ok) return NextResponse.json(b2bGuardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = creditCheckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid credit check.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const customer = demoB2bStore.getCustomer(parsed.data.customerId);
  if (!customer) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "B2B customer not found." } }, { status: 404 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const result = checkCredit(customer, parsed.data.orderTotalPoisha, today);
  return NextResponse.json({ data: { creditCheck: result }, meta: { persistence: "in-memory-demo" } });
}
