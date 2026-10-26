import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import { decideApproval } from "@/orders/approvals";

// POST /api/v1/admin/approvals/[id]/decide — approve or reject one
// approval request (ADV-27). Guard: orders.edit — the manager-level
// permission (Owner + Manager in the default catalogue; the roles
// that REQUEST approvals by confirming orders hold
// orders.update_status without orders.edit, so requester and
// approver are different people by construction).
// Reject REQUIRES a reason. Every decision is audited
// (orders.approval_decide) with the request snapshot.

const decideSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("orders.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => null);
  const parsed = decideSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Decision input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }
  const result = await decideApproval(params.id, parsed.data.decision, { id: guard.userId }, parsed.data.reason);
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : result.code === "REASON_REQUIRED" ? 400 : 409;
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status });
  }
  await writeAudit({
    actorId: guard.userId,
    action: "orders.approval_decide",
    entityType: "Order",
    entityId: result.record.orderId,
    beforeJson: { approvalId: result.record.id, status: "PENDING" },
    afterJson: {
      approvalId: result.record.id,
      status: result.record.status,
      kind: result.record.kind,
      refundId: result.record.refundId,
      discountBps: result.record.discountBps,
      amountPoisha: result.record.amountPoisha,
    },
    reason: result.record.decisionReason ?? undefined,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { record: result.record }, meta: { persistence: "database" } });
}
