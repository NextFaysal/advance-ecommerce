import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { z } from "zod";

// Call QA scoring — C3. PATCH { qaScore 0..5, qaComment? } stamps a
// supervisor's QA score onto one call log (CallLogEntry.qaScore /
// qaComment, written directly — scoring is a review action, not part
// of the outcome state machine). Supervisor-only: staff.manage.
// The score write is audit-logged. Flag: module.call_center.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
    { status: 503 },
  );
}

const patchBodySchema = z.object({
  qaScore: z.number().int().min(0).max(5),
  qaComment: z.string().max(1000).optional(),
});

export async function PATCH(req: Request, { params }: { params: { logId: string } }) {
  const guard = await requireAdmin("staff.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const parsed = patchBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "qaScore (integer 0..5) required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const row = await prisma.callLogEntry.update({
      where: { id: params.logId },
      data: {
        qaScore: parsed.data.qaScore,
        qaComment: parsed.data.qaComment?.trim() ? parsed.data.qaComment.trim() : null,
      },
      include: { task: { select: { kind: true, orderId: true } } },
    });
    try {
      await writeAudit({
        actorId: guard.userId,
        action: "call_center.qa_score",
        entityType: "CallLogEntry",
        entityId: row.id,
        afterJson: { qaScore: row.qaScore },
      });
    } catch {
      /* audit is best-effort here */
    }
    return NextResponse.json({
      data: {
        log: {
          id: row.id,
          taskId: row.taskId,
          source: row.task?.kind ?? "MANUAL",
          orderId: row.task?.orderId ?? null,
          agentId: row.agentId,
          outcome: row.outcome,
          disposition: row.disposition ?? null,
          scriptVersion: row.scriptVersion ?? null,
          note: row.note ?? null,
          qaScore: row.qaScore ?? null,
          qaComment: row.qaComment ?? null,
          calledAt: row.createdAt.toISOString(),
        },
      },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call log not found." } }, { status: 404 });
    }
    return dbNotReady();
  }
}
