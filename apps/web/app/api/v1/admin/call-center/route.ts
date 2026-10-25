import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { dueCallbacks, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { createManualTask, loadCallTasks, type DbCallTask } from "@/callcenter/store";
import { CONFIRMATION_SCRIPT, manualTaskSchema, type CallTask } from "@/callcenter/types";
import { normalizeBdPhone } from "@/checkout/validation";

// Call center queue — Agent 14, Step 46 (A10). RBAC: orders.view (list) / orders.create (manual task).
// Feature flag: module.call_center (defaults OFF -> 403 FEATURE_LOCKED).
// Persistence: Prisma DB via src/callcenter/store.ts. Order-linked
// tasks store only the MASKED phone (the full number resolves from the
// linked order at read time); MANUAL tasks store their own full number
// + name + note (C1) since no order exists to resolve from. Either way a
// full number is served only when one is available server-side AND the
// caller holds customers.view_full_phone.
// Assignment (G3, Agent 58): the queue ALWAYS serves the session user's own
// tasks plus the unassigned pool — there is no ?agentId= preview; another
// agent's tasks are never listed here.
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

/** View gate: full phone only when permitted AND a full number is
 *  available server-side (phoneResolved — from the linked order, or a
 *  manual task's own stored number, C1). */
function view(task: DbCallTask | (CallTask & { phoneResolved?: boolean }), canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  const now = new Date().toISOString();
  // Session user's own queue only: tasks assigned to them + the unassigned
  // pool. No query parameter can widen this to another agent (G3).
  const agentId = guard.userId;
  try {
    const tasks = await loadCallTasks();
    const visible = tasks.filter(
      (t) => t.assignedAgentId === null || t.assignedAgentId === agentId,
    );
    const nextPick = nextTaskForAgent(tasks, agentId, now);
    const next = nextPick ? (tasks.find((t) => t.id === nextPick.id) ?? null) : null;
    // dueCallbacks() narrows to the queue module's CallTask type; the
    // rows are the same loaded objects, so re-resolve them by id to
    // keep the DbCallTask (phoneResolved) view gate — same pattern as
    // `next` above.
    const due = dueCallbacks(visible, now)
      .map((cb) => tasks.find((t) => t.id === cb.id) ?? null)
      .filter((t): t is DbCallTask => t !== null);
    const unassignedCount = tasks.filter(
      (t) => t.status === "QUEUED" && t.assignedAgentId === null,
    ).length;
    // C1 "my callbacks": every pending callback assigned to the SESSION
    // agent (due or not), earliest first — dueCallbacks above only
    // carries the ones already due. Rows come from the same scoped
    // load, so no other agent's callback can appear here.
    const myCallbacks = tasks
      .filter(
        (t) =>
          t.assignedAgentId === agentId &&
          t.callbackAt !== undefined &&
          (t.status === "QUEUED" || t.status === "IN_CALL"),
      )
      .sort((a, b) => (a.callbackAt as string).localeCompare(b.callbackAt as string));
    return NextResponse.json({
      data: {
        queue: visible.map((t) => view(t, canViewFullPhone)),
        nextTask: next ? view(next, canViewFullPhone) : null,
        dueCallbacks: due.map((t) => view(t, canViewFullPhone)),
        myCallbacks: myCallbacks.map((t) => view(t, canViewFullPhone)),
        unassignedCount,
        script: CONFIRMATION_SCRIPT,
      },
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}

/** POST a MANUAL call task (e.g. a number from a Facebook comment).
 *  Phone is normalized server-side. A manual task has no order to
 *  resolve a number from, so the full number + name + note ARE stored
 *  on the task (C1) — the full number is still only SERVED to callers
 *  holding customers.view_full_phone. */
export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const parsed = manualTaskSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid manual task.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const phone = normalizeBdPhone(parsed.data.phone);
  if (!phone) {
    return NextResponse.json(
      { error: { code: "INVALID_PHONE", message: "Sothik Bangladesh mobile number din (01XXXXXXXXX)." } },
      { status: 400 },
    );
  }
  try {
    const task = await createManualTask({
      customerName: parsed.data.customerName,
      phone,
      note: parsed.data.note,
    });
    const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
    return NextResponse.json(
      { data: { task: view(task, canViewFullPhone) }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch {
    return dbNotReady();
  }
}
