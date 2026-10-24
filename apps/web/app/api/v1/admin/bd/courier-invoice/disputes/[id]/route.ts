import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  disputeStatuses,
  getDispute,
  saveAdjustment,
  transitionDispute,
  updateDispute,
} from "@/bd/courier-invoice";

// PATCH /api/v1/admin/bd/courier-invoice/disputes/[id] — Agent 50.
// RBAC: reports.accounting.
// Moves a dispute through OPEN -> EVIDENCE_ATTACHED -> SUBMITTED ->
// ACCEPTED/REJECTED -> CLOSED. An adjustment may be supplied ONLY on
// the ACCEPTED transition and is stored as a separate adjustment
// record — the dispute's snapshotted amounts and the run row's amounts
// are never edited. Persistence: DB-backed (courier_disputes /
// dispute_adjustments).
const transitionRequestSchema = z.object({
  to: z.enum(disputeStatuses),
  note: z.string().optional(),
  evidenceRef: z.string().optional(),
  adjustment: z
    .object({
      direction: z.enum(["courier_owes", "merchant_owes"]),
      amountPoisha: z.number().int().positive(),
      note: z.string().min(1),
    })
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = transitionRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid dispute transition request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const dispute = await getDispute(params.id);
  if (!dispute) {
    return NextResponse.json(
      { error: { code: "DISPUTE_NOT_FOUND", message: `No dispute with id ${params.id}.` } },
      { status: 404 },
    );
  }
  const result = transitionDispute(dispute, { ...parsed.data, by: guard.userId });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 });
  }
  const savedDispute = await updateDispute(result.value.dispute);
  const savedAdjustment = result.value.adjustment ? await saveAdjustment(result.value.adjustment) : null;
  return NextResponse.json({
    data: { dispute: savedDispute, adjustment: savedAdjustment },
    meta: { persistence: "database" },
  });
}
