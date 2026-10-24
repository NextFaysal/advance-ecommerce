import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { claimAssignedTask, toQueueItemView } from "@/callcenter/queue";
import { claimNextTaskInStore, demoCallTasks } from "@/callcenter/service";

// Claim a call task — Agent 58 (G3 assignment enforcement).
// POST with no body (or no taskId) claims the highest-priority UNASSIGNED
// task for the SESSION user (claim-next). POST { taskId } claims that
// specific task. Claiming is the required first step before an outcome can
// be recorded (see outcome route: unassigned -> 409 TASK_UNASSIGNED).
// A task assigned to another agent can never be claimed (403
// TASK_ASSIGNED_TO_OTHER) — supervisors use the outcome override instead.
export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
      { status: 403 },
    );
  }
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const body = (await req.json().catch(() => ({}))) as { taskId?: unknown };
  const now = new Date().toISOString();

  if (typeof body.taskId === "string") {
    const idx = demoCallTasks.findIndex((t) => t.id === body.taskId);
    const task = demoCallTasks[idx];
    if (idx === -1 || !task) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call task not found." } }, { status: 404 });
    }
    const result = claimAssignedTask(task, guard.userId, now);
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: result.code, message: result.error } },
        { status: result.code === "TASK_ASSIGNED_TO_OTHER" ? 403 : 409 },
      );
    }
    demoCallTasks[idx] = result.task;
    return NextResponse.json({
      data: { task: toQueueItemView(result.task, canViewFullPhone), alreadyMine: result.alreadyMine },
      meta: { persistence: "in-memory-demo" },
    });
  }

  const claimed = claimNextTaskInStore(guard.userId, now);
  return NextResponse.json({
    data: { task: claimed ? toQueueItemView(claimed, canViewFullPhone) : null },
    meta: { persistence: "in-memory-demo" },
  });
}
