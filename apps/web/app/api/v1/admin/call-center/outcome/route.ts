import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { agentPerformance, nextTaskForAgent, toQueueItemView } from "@/callcenter/queue";
import { loadCallLogs, loadCallTasks, recordOutcomeDb, type DbCallTask } from "@/callcenter/store";
import { recordOutcomeSchema, type CallTask } from "@/callcenter/types";
import { dispositionSchema, isFraudSignalDisposition } from "@/callcenter/dispositions";
import { runOutcomeAutomations, type OutcomeAutomationSummary } from "@/callcenter/automation";
import { isInRetryBackoff } from "@/callcenter/store";
import { fraudListStore } from "@/fraud/lists";
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
// C4: after the outcome persists, the follow-up automation layer
// (src/callcenter/automation.ts) evaluates its rules — retry backoff,
// auto SMS scheduling, callback reminders — gated by the
// module.call_center_automation kill switch (seeded OFF). It is
// best-effort like the fraud hook: the summary rides the response as
// data.automation, and an automation failure never fails the outcome.
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
  await ensureDbFeatureFlags().catch(() => {});
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
  await ensureDbFeatureFlags().catch(() => {});
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
    // C4 follow-up automation — best-effort (see header). The layer
    // itself never throws; the extra guard here keeps even a module
    // load failure from failing the already-persisted outcome.
    let automation: OutcomeAutomationSummary | undefined;
    try {
      automation = await runOutcomeAutomations({
        task: result.task,
        outcome: parsed.data.outcome,
        callbackAt: parsed.data.callbackAt,
      });
    } catch {
      automation = undefined;
    }
    const canViewFullPhone = guard.permissions.includes("customers.view_full_phone");
    const tasks = await loadCallTasks();
    const nowIso = new Date().toISOString();
    // C4: never offer a task that is sitting in retry backoff as the
    // agent's next task (the claim paths refuse it too — store.ts).
    const offerable = tasks.filter((t) => !isInRetryBackoff(t, nowIso));
    const nextPick = nextTaskForAgent(offerable, guard.userId, nowIso);
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
        ...(automation ? { automation } : {}),
      },
      meta: { persistence: "database" },
    });
  } catch {
    return dbNotReady();
  }
}
