import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { agentPerformance, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { loadCallLogs, loadCallTasks, recordOutcomeDb, type DbCallTask } from "@/callcenter/store";
import { recordOutcomeSchema, type CallTask } from "@/callcenter/types";

// Call outcome + auto-next — Agent 14. POST { taskId, ...outcome } records the
// outcome (CALLBACK requires a future callbackAt; NO_ANSWER re-queues up to
// MAX_ATTEMPTS) and returns the agent's NEXT task in the same response, which
// is the auto-next queue flow: finish a call -> next task is already there.
// GET returns the calling agent's performance rollup.
// Assignment enforcement (G3, Agent 58): an outcome can only be recorded on
// a task CLAIMED by the caller (unassigned -> 409 TASK_UNASSIGNED; another
// agent's task -> 403 TASK_ASSIGNED_TO_OTHER). The one exception is a
// supervisor (staff.manage), whose override is stamped on the call log entry.
// Persistence: Prisma DB via src/callcenter/store.ts. CONFIRMED / CANCELLED
// outcomes also drive the linked order through the orders state machine
// (applyOrderTransition); the effect is reported as data.orderEffect.
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

function view(task: DbCallTask | (CallTask & { phoneResolved?: boolean }), canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  try {
    const logs = await loadCallLogs(guard.userId);
    return NextResponse.json({
      data: { performance: agentPerformance(logs, guard.userId) },
      meta: { persistence: "database" },
    });
  } catch {
    return dbNotReady();
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const body = (await req.json().catch(() => ({}))) as { taskId?: string };
  const parsed = recordOutcomeSchema.safeParse(body);
  if (!parsed.success || typeof body.taskId !== "string") {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "taskId + valid outcome required.", details: parsed.success ? [] : parsed.error.issues } },
      { status: 400 },
    );
  }
  const isSupervisor = guard.permissions.includes("staff.manage");
  try {
    const result = await recordOutcomeDb(body.taskId, parsed.data, {
      agentId: guard.userId,
      isSupervisor,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call task not found." } }, { status: 404 });
      }
      if (result.code === "TASK_UNASSIGNED") {
        return NextResponse.json(
          {
            error: {
              code: result.code,
              message: result.error,
              details: { hint: "Claim the task first: POST /api/v1/admin/call-center/claim" },
            },
          },
          { status: 409 },
        );
      }
      if (result.code === "TASK_ASSIGNED_TO_OTHER") {
        return NextResponse.json(
          { error: { code: result.code, message: result.error } },
          { status: 403 },
        );
      }
      return NextResponse.json({ error: { code: "OUTCOME_REJECTED", message: result.error } }, { status: 422 });
    }
    const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
    const tasks = await loadCallTasks();
    const nextPick = nextTaskForAgent(tasks, guard.userId, new Date().toISOString());
    const next = nextPick ? (tasks.find((t) => t.id === nextPick.id) ?? null) : null;
    const logs = await loadCallLogs(guard.userId);
    return NextResponse.json({
      data: {
        task: view(result.task, canViewFullPhone),
        log: result.log,
        orderEffect: result.orderEffect,
        nextTask: next ? view(next, canViewFullPhone) : null,
        performance: agentPerformance(logs, guard.userId),
      },
      meta: { persistence: "database" },
    });
  } catch {
    return dbNotReady();
  }
}
