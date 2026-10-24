import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { toQueueItemView } from "@/callcenter/queue";
import { claimNextTaskDb, claimTaskDb, type DbCallTask } from "@/callcenter/store";

// Claim a call task — Agent 58 (G3 assignment enforcement).
// POST with no body (or no taskId) claims the highest-priority UNASSIGNED
// task for the SESSION user (claim-next). POST { taskId } claims that
// specific task. Claiming is the required first step before an outcome can
// be recorded (see outcome route: unassigned -> 409 TASK_UNASSIGNED).
// A task assigned to another agent can never be claimed (403
// TASK_ASSIGNED_TO_OTHER) — supervisors use the outcome override instead.
// Persistence: Prisma DB via src/callcenter/store.ts; the claim persists
// with a conditional update so two agents cannot claim the same task.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function view(task: DbCallTask, canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const body = (await req.json().catch(() => ({}))) as { taskId?: unknown };

  try {
    if (typeof body.taskId === "string") {
      const result = await claimTaskDb(body.taskId, guard.userId);
      if (!result.ok) {
        if (result.code === "NOT_FOUND") {
          return NextResponse.json({ error: { code: "NOT_FOUND", message: "Call task not found." } }, { status: 404 });
        }
        return NextResponse.json(
          { error: { code: result.code, message: result.error } },
          { status: result.code === "TASK_ASSIGNED_TO_OTHER" ? 403 : 409 },
        );
      }
      return NextResponse.json({
        data: { task: view(result.task, canViewFullPhone), alreadyMine: result.alreadyMine },
        meta: { persistence: "database" },
      });
    }

    const claimed = await claimNextTaskDb(guard.userId);
    return NextResponse.json({
      data: { task: claimed ? view(claimed, canViewFullPhone) : null },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
      { status: 503 },
    );
  }
}
