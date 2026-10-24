import { NextResponse } from "next/server";
import { reconcileCourierInvoice, reconcileRequestSchema } from "@/bd/courier-reconciliation";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/bd/courier-reconciliation — Agent 11, Step 45 (E4).
// RBAC: reports.accounting.
// Pure computation, no persistence: the caller supplies the expected
// shipment rows and the courier invoice rows; the response separates
// matched money from disputed money. Disputed rows are returned with
// their original expected values — this route has no code path that
// writes back or "fixes" an expected value to match the invoice.
export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = reconcileRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid reconciliation request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = reconcileCourierInvoice(parsed.data.expected, parsed.data.invoice);
  return NextResponse.json({ data: result, meta: { persistence: "none-pure-logic" } });
}
