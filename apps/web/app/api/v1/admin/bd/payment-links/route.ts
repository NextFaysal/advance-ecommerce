import { NextResponse } from "next/server";
import {
  createPaymentLink,
  createPaymentLinkSchema,
  demoPaymentLinkStore,
  withEffectiveStatus,
} from "@/bd/payment-link";
import { guardError, requireAdmin } from "@/reports/guard";

// Payment links — Agent 11, Step 44 (E1).
// GET: RBAC payments.view. Lists a order's links WITHOUT any token or
// token hash — hashes are a server secret-equivalent and never leave.
// POST: RBAC payments.verify_manual. Creates a link; the plain token +
// URL are returned ONCE in this response (for staff to send), and only
// the token hash is kept — in the IN-MEMORY-DEMO store for now.
// DB version: payment_links table (tokenHash unique), see payment-link.ts.
export async function GET(req: Request) {
  const guard = await requireAdmin("payments.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const orderId = new URL(req.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "orderId query param required." } }, { status: 400 });
  }
  const now = new Date();
  const links = demoPaymentLinkStore.listByOrder(orderId).map((r) => {
    const effective = withEffectiveStatus(r, now);
    return {
      id: effective.id,
      orderId: effective.orderId,
      amountPoisha: effective.amountPoisha,
      purpose: effective.purpose,
      status: effective.status,
      createdAt: effective.createdAt,
      expiresAt: effective.expiresAt,
      paidAt: effective.paidAt,
    };
  });
  return NextResponse.json({ data: { links }, meta: { persistence: "in-memory-demo" } });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("payments.verify_manual");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = createPaymentLinkSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid payment link request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const created = createPaymentLink(parsed.data);
  demoPaymentLinkStore.add(created.record);
  return NextResponse.json(
    {
      data: {
        id: created.record.id,
        orderId: created.record.orderId,
        amountPoisha: created.record.amountPoisha,
        purpose: created.record.purpose,
        status: created.record.status,
        expiresAt: created.record.expiresAt,
        // Returned once, for the staff member to send to the customer.
        url: created.url,
      },
      meta: { persistence: "in-memory-demo" },
    },
    { status: 201 },
  );
}
