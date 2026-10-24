import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { agentPerformance, checkOutcomeAccess, claimTask, nextTaskForAgent, recordOutcome, toQueueItemView } from "@/callcenter/queue";
import { demoCallLogs, demoCallTasks } from "@/callcenter/service";
import { recordOutcomeSchema } from "@/callcenter/types";

// Call outcome + auto-next — Agent 14. POST { taskId, ...outcome } records the
// outcome (CALLBACK requires a future callbackAt; NO_ANSWER re-queues up to
// MAX_ATTEMPTS) and returns the agent's NEXT task in the same response, which
// is the auto-next queue flow: finish a call -> next task is already there.
// GET returns the calling agent's performance rollup.
// Assignment enforcement (G3, Agent 58): an outcome can only be recorded on
// a task CLAIMED by the caller (unassigned -> 409 TASK_UNASSIGNED; another
// agent's task -> 403 TASK_ASSIGNED_TO_OTHER). The one exception is a
// supervisor (staff.manage), whose override is stamped on the call log entry.
export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
      { status: 403 },
    );
  }
  return NextResponse.json({
    data: { performance: agentPerformance(demoCallLogs, guard.userId) },
    meta: { persistence: "in-memory-demo" },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { taskId?: string };
  const parsed = recordOutcomeSchema.safeParse(body);
  if (!parsed.success || typeof body.taskId !== "string") {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "taskId + valid outcome required.", details: parsed.success ? [] : parsed.error.issues } },
      { status: 400 },
    );
  }
  const idx = demoCallTasks.findIndex((t) => t.id === body.taskId);
  const task = demoCallTasks[idx];
  if (idx === -1 || !task) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call task not found." } }, { status: 404 });
  }
  // G3 assignment gate: only the assignee may record an outcome; a
  // supervisor (staff.manage) may override on another agent's task, and the
  // override is recorded on the call log entry (supervisorOverride: true).
  const isSupervisor = guard.permissions.includes("staff.manage");
  const access = checkOutcomeAccess(task, guard.userId, isSupervisor);
  if (!access.allowed) {
    if (access.code === "TASK_UNASSIGNED") {
      return NextResponse.json(
        {
          error: {
            code: access.code,
            message: access.error,
            details: { hint: "Claim the task first: POST /api/v1/admin/call-center/claim" },
          },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: access.code, message: access.error } },
      { status: 403 },
    );
  }
  const now = new Date().toISOString();
  // The assignee's own QUEUED task moves to IN_CALL before the outcome is
  // recorded (pre-G3 behaviour). A supervisor-override task is NOT re-claimed:
  // it keeps its original assignee, so a re-queue outcome (CALLBACK /
  // NO_ANSWER) returns it to the agent who owns it.
  const inCall =
    task.status === "QUEUED" && task.assignedAgentId === guard.userId
      ? claimTask(task, guard.userId, now)
      : task;
  const result = recordOutcome(inCall, parsed.data, {
    logId: `log-${Date.now()}`,
    agentId: guard.userId,
    calledAt: now,
    supervisorOverride: access.supervisorOverride,
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: "OUTCOME_REJECTED", message: result.error } }, { status: 422 });
  }
  demoCallTasks[idx] = result.task;
  demoCallLogs.push(result.log);
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const next = nextTaskForAgent(demoCallTasks, guard.userId, now);
  return NextResponse.json({
    data: {
      task: toQueueItemView(result.task, canViewFullPhone),
      log: result.log,
      nextTask: next ? toQueueItemView(next, canViewFullPhone) : null,
      performance: agentPerformance(demoCallLogs, guard.userId),
    },
    meta: { persistence: "in-memory-demo" },
  });
}
