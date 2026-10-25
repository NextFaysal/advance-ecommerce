import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import {
  forceCloseTask,
  reassignTask,
  releaseTask,
  type SupervisorActionResult,
} from "@/callcenter/supervisor-store";

// Call-center SUPERVISOR actions — C2. POST one of:
//   { action: "reassign",    taskId, agentId }  -> move a QUEUED/IN_CALL task to another agent
//   { action: "release",     taskId }           -> back to the unassigned QUEUED pool
//   { action: "force-close", taskId, reason }   -> status SKIPPED with a stated reason
// RBAC: staff.manage (same supervisor definition as the board GET and
// the outcome route's G3 override). Feature flag: module.call_center.
// Audit trail: like every other call-center route, this module writes
// NO writeAudit entries — each action is recorded on the task itself
// as a CallLogEntry (outcome REASSIGNED / RELEASED / FORCE_CLOSED,
// agentId = the acting supervisor, note naming from/to or the reason),
// written by src/callcenter/supervisor-store.ts in the same
// transaction as the task update.
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

const actionSchema = z.object({
  action: z.enum(["reassign", "release", "force-close"]),
  taskId: z.string().min(1),
  agentId: z.string().min(1).optional(),
  reason: z.string().max(500).optional(),
});

function respond(result: SupervisorActionResult) {
  if (result.ok) {
    return NextResponse.json({
      data: { taskId: result.taskId, note: result.note },
      meta: { persistence: "database" },
    });
  }
  const status =
    result.code === "NOT_FOUND" ? 404 : result.code === "INVALID_AGENT" ? 422 : 409;
  return NextResponse.json({ error: { code: result.code, message: result.error } }, { status });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("staff.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();

  const parsed = actionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid supervisor action.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { action, taskId, agentId, reason } = parsed.data;
  if (action === "reassign" && !agentId) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "agentId is required for reassign." } },
      { status: 400 },
    );
  }
  if (action === "force-close" && (!reason || reason.trim().length === 0)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A reason is required for force-close." } },
      { status: 400 },
    );
  }

  try {
    if (action === "reassign") return respond(await reassignTask(taskId, agentId as string, guard.userId));
    if (action === "release") return respond(await releaseTask(taskId, guard.userId));
    return respond(await forceCloseTask(taskId, reason as string, guard.userId));
  } catch {
    return dbNotReady();
  }
}
