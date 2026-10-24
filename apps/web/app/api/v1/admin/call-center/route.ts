import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { dueCallbacks, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { demoCallTasks } from "@/callcenter/service";
import { CONFIRMATION_SCRIPT, manualTaskSchema } from "@/callcenter/types";
import { normalizeBdPhone } from "@/checkout/validation";
import { priorityForSource } from "@/callcenter/queue";

// Call center queue — Agent 14, Step 46 (A10). RBAC: orders.view (list) / orders.create (manual task).
// Feature flag: module.call_center (demo store, defaults OFF -> 403 FEATURE_LOCKED).
// Phone: queue views are masked unless the caller has customers.view_full_phone
// (the guard's permission list is checked here; requireAdmin already enforced orders.*).
// Assignment (G3, Agent 58): the queue ALWAYS serves the session user's own
// tasks plus the unassigned pool — the old ?agentId= preview that let a
// caller view another agent's queue is removed; another agent's tasks are
// never listed here.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
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
  const visible = demoCallTasks.filter(
    (t) => t.assignedAgentId === null || t.assignedAgentId === agentId,
  );
  const next = nextTaskForAgent(demoCallTasks, agentId, now);
  const unassignedCount = demoCallTasks.filter(
    (t) => t.status === "QUEUED" && t.assignedAgentId === null,
  ).length;
  return NextResponse.json({
    data: {
      queue: visible.map((t) => toQueueItemView(t, canViewFullPhone)),
      nextTask: next ? toQueueItemView(next, canViewFullPhone) : null,
      dueCallbacks: dueCallbacks(visible, now).map((t) => toQueueItemView(t, canViewFullPhone)),
      unassignedCount,
      script: CONFIRMATION_SCRIPT,
    },
    meta: { persistence: "in-memory-demo", module: "module.call_center" },
  });
}

/** POST a MANUAL call task (e.g. a number from a Facebook comment). Phone is normalized server-side. */
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
  const task = {
    id: `call-${Date.now()}`,
    source: "MANUAL" as const,
    customerName: parsed.data.customerName,
    phone,
    orderTotalPoisha: 0,
    priority: priorityForSource("MANUAL"),
    status: "QUEUED" as const,
    assignedAgentId: null,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
  demoCallTasks.push(task);
  const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
  return NextResponse.json(
    { data: { task: toQueueItemView(task, canViewFullPhone) }, meta: { persistence: "in-memory-demo" } },
    { status: 201 },
  );
}
