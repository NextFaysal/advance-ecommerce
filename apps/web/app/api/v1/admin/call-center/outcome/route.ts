import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { agentPerformance, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { loadCallLogs, loadCallTasks, recordOutcomeDb, type DbCallTask } from "@/callcenter/store";
import { recordOutcomeSchema, type CallTask } from "@/callcenter/types";
import { dispositionSchema, isFraudSignalDisposition } from "@/callcenter/dispositions";
import { fraudListStore } from "@/fraud/lists";
import { dispatchCallFollowUp, type FollowUpResult } from "@/callcenter/follow-up";
import { z } from "zod";

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
// C3: the body may also carry `disposition` (canonical sub-reason from
// src/callcenter/dispositions.ts, validated here) and `scriptVersion`;
// both are stamped on the call log by recordOutcomeDb. A fraud-signal
// disposition (FAKE_ORDER / WRONG_NUMBER_CONFIRMED) additionally writes
// the phone into the fraud blacklist — only when the full number was
// resolved from the linked order (a masked number is never blacklisted);
// the outcome response reports the result as data.fraudSignal.
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

/** Base outcome schema + the C3 stamps (kept local so types.ts stays
 *  the base contract; recordOutcomeDb accepts both extra fields). */
const outcomeBodySchema = recordOutcomeSchema.extend({
  disposition: dispositionSchema.optional(),
  scriptVersion: z.string().trim().min(1).max(16).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.update_status");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  const body = (await req.json().catch(() => ({}))) as { taskId?: string };
  const parsed = outcomeBodySchema.safeParse(body);
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
    // C3 fraud signal: a FAKE_ORDER / WRONG_NUMBER_CONFIRMED disposition
    // blacklists the phone in the same DB-backed fraud list checkout
    // scores against. Only a RESOLVED full number is written — the
    // stored masked form could never match and must never be listed.
    // Best-effort: the outcome is already persisted, so a failed fraud
    // write is reported in the response, never fatal.
    let fraudSignal: { recorded: boolean; reason?: string } | undefined;
    if (parsed.data.disposition && isFraudSignalDisposition(parsed.data.disposition)) {
      if (result.task.phoneResolved === true && !result.task.phone.includes("*")) {
        try {
          await fraudListStore.add("blacklist", {
            id: randomUUID(),
            kind: "phone",
            value: result.task.phone,
            reason: `Call-center disposition ${parsed.data.disposition} (task ${body.taskId})`,
            createdAt: new Date().toISOString(),
          });
          fraudSignal = { recorded: true };
        } catch {
          fraudSignal = { recorded: false, reason: "fraud-list-write-failed" };
        }
      } else {
        fraudSignal = { recorded: false, reason: "phone-not-resolved" };
      }
    }
    // C4 Follow-up automation: trigger SMS when unanswered or callback scheduled
    let followUp: FollowUpResult | undefined;
    if (result.task.phoneResolved === true && !result.task.phone.includes("*")) {
      try {
        followUp = await dispatchCallFollowUp({
          customerPhone: result.task.phone,
          customerName: (result.task as any).customerName,
          orderId: result.task.orderId,
          outcome: parsed.data.outcome,
          callbackDue: parsed.data.callbackAt,
        });
      } catch (e) {
        console.error("[CallCenter Outcome] Follow-up SMS error:", e);
      }
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
        ...(fraudSignal ? { fraudSignal } : {}),
        ...(followUp ? { followUp } : {}),
      },
      meta: { persistence: "database" },
    });
  } catch {
    return dbNotReady();
  }
}
