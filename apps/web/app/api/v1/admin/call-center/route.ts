import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { dueCallbacks, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { getEffectiveScript } from "@/callcenter/scripts-store";
import { createManualTask, loadCallTasks, type DbCallTask } from "@/callcenter/store";
import {
  CONFIRMATION_SCRIPT,
  manualTaskSchema,
  type CallQueueSource,
  type CallTask,
} from "@/callcenter/types";
import { normalizeBdPhone } from "@/checkout/validation";
import { writeAudit } from "@/lib/audit";

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

/**
 * R2.1 (plan doc 15): the EFFECTIVE script per source — the admin-saved
 * Setting doc via scripts-store when one exists (its version, e.g.
 * "v2"), else the built-in CONFIRMATION_SCRIPT as "v1" — attached to
 * each task view as `script` (same shape as the claim route). The
 * workbench resumes an IN_CALL task from THIS payload after a reload,
 * so the resumed card needs the script here too, not only on claim.
 * scripts-store falls back to the built-in for missing/corrupt docs;
 * a store read failure falls back the same way per source and never
 * fails the queue read.
 */
const ALL_SOURCES: readonly CallQueueSource[] = [
  "PENDING_ORDER",
  "FAILED_DELIVERY",
  "ABANDONED_CHECKOUT",
  "MANUAL",
];

async function scriptsBySource() {
  const map = new Map<CallQueueSource, { version: string; steps: unknown }>();
  await Promise.all(
    ALL_SOURCES.map(async (source) => {
      try {
        const eff = await getEffectiveScript(source);
        map.set(source, { version: eff.versionLabel, steps: eff.steps });
      } catch {
        map.set(source, {
          version: "v1",
          steps: CONFIRMATION_SCRIPT.map((s) => ({
            key: s.key,
            promptBn: s.promptBn,
            promptEn: s.promptEn,
          })),
        });
      }
    }),
  );
  return map;
}

/** View gate: full phone only when permitted AND a full number is
 *  available server-side (phoneResolved — from the linked order, or a
 *  manual task's own stored number, C1). */
function view(task: DbCallTask | (CallTask & { phoneResolved?: boolean }), canViewFullPhone: boolean) {
  return toQueueItemView(task, canViewFullPhone && task.phoneResolved === true);
}

/**
 * Full-phone access audit (plan doc 15, R6.1 / C7 privacy hardening):
 * the queue GET is a BULK reveal — one response can carry the full
 * numbers of many tasks (queue list + nextTask + callback lists).
 * Unlike the claim/context routes (one row per reveal), this writes
 * ONE audit row per GET that actually revealed at least one full
 * phone, recording WHO listed, HOW MANY distinct tasks' numbers were
 * revealed (revealedCount), and the FIRST revealed task as the entity
 * — one row per task would flood the log. The numbers themselves —
 * full or masked — are NEVER written to the audit row. Masked-only
 * responses (unpermitted viewer, unresolved numbers, empty queue)
 * write nothing. Best-effort: an audit failure must never fail the
 * request (mirrors the claim/context routes).
 */
async function auditQueuePhoneViews(
  views: ReturnType<typeof view>[],
  actorId: string,
): Promise<void> {
  const revealed = new Map<string, ReturnType<typeof view>>();
  for (const v of views) {
    if (v.phoneFull && !revealed.has(v.id)) revealed.set(v.id, v);
  }
  if (revealed.size === 0) return;
  const first = revealed.values().next().value as ReturnType<typeof view>;
  try {
    await writeAudit({
      actorId,
      action: "call_center.phone_view",
      entityType: "CallTask",
      entityId: first.id,
      afterJson: {
        taskId: first.id,
        source: first.source,
        via: "queue",
        revealedCount: revealed.size,
      },
    });
  } catch {
    /* audit is best-effort here */
  }
}

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
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
    // R2.1: every task view also carries its source's EFFECTIVE
    // script (see scriptsBySource) — the resumed IN_CALL row in
    // `queue` is what the workbench rebuilds its card from on reload.
    const scripts = await scriptsBySource();
    const queueViews = visible.map((t) => ({
      ...view(t, canViewFullPhone),
      script: scripts.get(t.source),
    }));
    const nextView = next
      ? { ...view(next, canViewFullPhone), script: scripts.get(next.source) }
      : null;
    const dueViews = due.map((t) => ({
      ...view(t, canViewFullPhone),
      script: scripts.get(t.source),
    }));
    const myCallbackViews = myCallbacks.map((t) => ({
      ...view(t, canViewFullPhone),
      script: scripts.get(t.source),
    }));
    // R6.1 bulk phone-view audit: one row if this response revealed
    // any full phone across any of its lists.
    await auditQueuePhoneViews(
      [...queueViews, ...(nextView ? [nextView] : []), ...dueViews, ...myCallbackViews],
      guard.userId,
    );
    return NextResponse.json({
      data: {
        queue: queueViews,
        nextTask: nextView,
        dueCallbacks: dueViews,
        myCallbacks: myCallbackViews,
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
  await ensureDbFeatureFlags();
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
