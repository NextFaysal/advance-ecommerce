// Admin manual TrxID review — Agent 9.
// GET  /api/v1/admin/payments/manual-trx?status=pending  (payments.view)
// POST /api/v1/admin/payments/manual-trx                 (payments.verify_manual)
//   body { submissionId, action: "approve" | "reject", reason }
// Rules (manual-trx.ts): a submission is reviewed once only, the same
// (method, TrxID) can never be approved twice, and a reason is required.
// The review is audited with the submission id and before/after status
// only — the full TrxID is never written to the audit record.
// Persistence: database (manual_trx_submissions; UNIQUE(method, trxId)
// is the duplicate backstop).
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import {
  listManualTrx,
  manualTrxReviewSchema,
  reviewManualTrx,
} from "@/integrations/sandbox/manual-trx";
import { writeAudit } from "@/lib/audit";

function errorResponse(httpStatus: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status: httpStatus });
}

export async function GET(req: Request) {
  const guard = await requireAdminPermission("payments.view");
  if (!guard.ok) return errorResponse(guard.httpStatus, guard.code, guard.message);
  const status = new URL(req.url).searchParams.get("status");
  const allowed = ["pending", "approved", "rejected"] as const;
  const filter = allowed.includes(status as (typeof allowed)[number])
    ? (status as (typeof allowed)[number])
    : undefined;
  return NextResponse.json({ data: await listManualTrx(filter), meta: { sandbox: true, persistence: "database" } });
}

export async function POST(req: Request) {
  const guard = await requireAdminPermission("payments.verify_manual");
  if (!guard.ok) return errorResponse(guard.httpStatus, guard.code, guard.message);
  const body = await req.json().catch(() => ({}));
  const parsed = manualTrxReviewSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(400, "INVALID_INPUT", "submissionId, action (approve/reject) and a reason are required.");
  }
  const before = (await listManualTrx()).find((s) => s.id === parsed.data.submissionId) ?? null;
  const result = await reviewManualTrx(parsed.data, guard.user.id);
  if (!result.ok) return errorResponse(409, "REVIEW_FAILED", result.error);
  await writeAudit({
    actorId: guard.user.id,
    action: parsed.data.action === "approve" ? "payments.verify_manual.approve" : "payments.verify_manual.reject",
    entityType: "ManualTrxSubmission",
    entityId: result.submission.id,
    beforeJson: before ? { status: before.status } : null,
    afterJson: { status: result.submission.status, paymentStatus: result.paymentStatus },
    reason: parsed.data.reason,
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({
    data: { submission: result.submission, paymentStatus: result.paymentStatus },
    meta: { sandbox: true, persistence: "database" },
  });
}
