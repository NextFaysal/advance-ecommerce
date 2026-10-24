import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { createDispute, getInvoiceRun, listDisputes, saveDispute } from "@/bd/courier-invoice";

// POST /api/v1/admin/bd/courier-invoice/disputes — Agent 50.
// RBAC: reports.accounting.
// Creates a dispute from a DISPUTED row of an import run. Body:
// { runId, rowId, reason } — reason is mandatory. The dispute snapshots
// the row's expected/invoiced amounts read-only; creating it changes no
// amount anywhere. Persistence: DB-backed (courier_disputes).
const createRequestSchema = z.object({
  runId: z.string().min(1),
  rowId: z.string().min(1),
  reason: z.string().min(3),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = createRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid dispute request (runId, rowId and a reason of at least 3 characters are required).", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const run = await getInvoiceRun(parsed.data.runId);
  if (!run) {
    return NextResponse.json(
      { error: { code: "RUN_NOT_FOUND", message: `No import run with id ${parsed.data.runId}.` } },
      { status: 404 },
    );
  }
  const result = createDispute({
    run,
    rowId: parsed.data.rowId,
    reason: parsed.data.reason,
    createdBy: guard.userId,
    existingDisputes: await listDisputes(),
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 });
  }
  const saved = await saveDispute(result.value);
  return NextResponse.json({ data: saved, meta: { persistence: "database" } }, { status: 201 });
}
