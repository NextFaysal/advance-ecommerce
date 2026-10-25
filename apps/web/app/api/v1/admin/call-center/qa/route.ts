import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { prisma } from "@advance-ecommerce/db";

// Call QA sampling — C3. GET returns completed call logs newest-first
// (every recorded outcome is a completed call) for supervisor review:
// task source, agent, outcome, disposition, note, and the QA score /
// comment once a supervisor has scored the call (PATCH qa/[logId]).
// Filters: ?agentId= and ?minScore= (only logs scored at or above).
// RBAC: orders.view, mirroring the sibling call-center read routes.
// Flag: module.call_center.
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

export async function GET(req: Request) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const url = new URL(req.url);
  const agentId = url.searchParams.get("agentId")?.trim() || undefined;
  const minScoreRaw = url.searchParams.get("minScore");
  const minScore = minScoreRaw !== null && minScoreRaw !== "" ? Number(minScoreRaw) : undefined;
  if (minScore !== undefined && (!Number.isInteger(minScore) || minScore < 0 || minScore > 5)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "minScore must be an integer 0..5." } },
      { status: 400 },
    );
  }
  try {
    const rows = await prisma.callLogEntry.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(minScore !== undefined ? { qaScore: { gte: minScore } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { task: { select: { kind: true, orderId: true } } },
    });
    const agentIds = [...new Set(rows.map((r) => r.agentId).filter((v): v is string => !!v))];
    const agents = agentIds.length
      ? await prisma.user.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const agentName = new Map(agents.map((a) => [a.id, a.name ?? a.email ?? a.id]));
    const logs = rows.map((r) => ({
      id: r.id,
      taskId: r.taskId,
      source: r.task?.kind ?? "MANUAL",
      orderId: r.task?.orderId ?? null,
      agentId: r.agentId,
      agentName: r.agentId ? (agentName.get(r.agentId) ?? r.agentId) : null,
      outcome: r.outcome,
      disposition: r.disposition ?? null,
      scriptVersion: r.scriptVersion ?? null,
      note: r.note ?? null,
      qaScore: r.qaScore ?? null,
      qaComment: r.qaComment ?? null,
      calledAt: r.createdAt.toISOString(),
    }));
    const unscored = logs.filter((l) => l.qaScore === null).length;
    return NextResponse.json({
      data: { logs, returned: logs.length, unscored },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}
