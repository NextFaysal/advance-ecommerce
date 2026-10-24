import { NextResponse } from "next/server";
import {
  createPaymentLink,
  createPaymentLinkSchema,
  paymentLinkStore,
  withEffectiveStatus,
} from "@/bd/payment-link";
import { SandboxOrderNotFoundError } from "@/integrations/sandbox/db-store";
import { guardError, requireAdmin } from "@/reports/guard";

// Payment links — Agent 11, Step 44 (E1).
// GET: RBAC payments.view. Lists a order's links WITHOUT any token or
// token hash — hashes are a server secret-equivalent and never leave.
// POST: RBAC payments.verify_manual. Creates a link; the plain token +
// URL are returned ONCE in this response (for staff to send), and only
// the token hash is kept — in the payment_links table (DB swap
// 2026-10-24; tokenHash unique). The order reference (id or orderNo)
// must resolve to a real Order row.
export async function GET(req: Request) {
  const guard = await requireAdmin("payments.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const orderId = new URL(req.url).searchParams.get("orderId");
  if (!orderId) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "orderId query param required." } }, { status: 400 });
  }
  const now = new Date();
  const records = await paymentLinkStore.listByOrder(orderId);
  const links = records.map((r) => {
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
  return NextResponse.json({ data: { links }, meta: { persistence: "database" } });
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
  try {
    await paymentLinkStore.add(created.record);
  } catch (err) {
    if (err instanceof SandboxOrderNotFoundError) {
      return NextResponse.json(
        { error: { code: "ORDER_NOT_FOUND", message: "Order not found for this payment link." } },
        { status: 400 },
      );
    }
    throw err;
  }
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
      meta: { persistence: "database" },
    },
    { status: 201 },
  );
}
