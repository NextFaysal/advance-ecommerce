/**
 * Call queue logic — pure. Agent 14; assignment enforcement (G3) by Agent 58.
 *
 * Auto-next discipline: the queue is a strict priority + age order. An agent
 * finishing a call gets the highest-priority QUEUED task; a task whose
 * callback is not yet due is NOT offered early (except it becomes due while
 * the agent is idle — isCallbackDue is checked at pick time, not stored).
 * NO_ANSWER tasks re-queue up to MAX_ATTEMPTS, then close as DONE so a dead
 * number can never loop an agent forever.
 *
 * Assignment enforcement (G3, see docs/AGENT14-REVIEW.md): a task must be
 * CLAIMED before an outcome can be recorded on it, and only the assignee may
 * record outcomes — except a supervisor (staff.manage, checked at the route)
 * whose override is stamped on the call log entry. The pure gates are
 * claimNextTask / claimAssignedTask / checkOutcomeAccess below; the routes
 * own the permission checks and HTTP status mapping.
 */
import { maskPhone } from "../checkout/validation";
import { CALL_OUTCOMES } from "./types";
import type {
  AgentPerformance,
  CallLogEntry,
  CallQueueSource,
  CallTask,
  CallTaskView,
  RecordOutcomeInput,
} from "./types";

/** After this many attempts a NO_ANSWER task is closed, not re-queued. */
export const MAX_ATTEMPTS = 3;

/** Base priority per source; FAILED_DELIVERY rescue beats fresh confirmations. */
export function priorityForSource(source: CallQueueSource): number {
  switch (source) {
    case "FAILED_DELIVERY":
      return 40;
    case "PENDING_ORDER":
      return 30;
    case "ABANDONED_CHECKOUT":
      return 20;
    case "MANUAL":
      return 10;
  }
}

export function isCallbackDue(task: CallTask, nowIso: string): boolean {
  if (!task.callbackAt) return true; // not a callback task — always offerable
  return task.callbackAt <= nowIso;
}

/**
 * C4 retry backoff: a task whose nextAttemptAt is still in the future is
 * NOT offerable, however high its priority. Mirrors isCallbackDue's edge
 * semantics — at exactly nextAttemptAt the backoff has expired and the
 * task is offerable again. Idempotent: safe on lists a caller already
 * filtered, since it only ever removes tasks.
 */
export function isRetryBackoffActive(task: CallTask, nowIso: string): boolean {
  if (!task.nextAttemptAt) return false; // never backed off — always offerable
  return task.nextAttemptAt > nowIso;
}

/**
 * Pick the next task for an agent: QUEUED, assigned to them or unassigned,
 * callback due, retry backoff (C4 nextAttemptAt) expired, highest priority
 * first, then oldest first. Returns null when the queue has nothing
 * offerable right now.
 */
export function nextTaskForAgent(
  tasks: readonly CallTask[],
  agentId: string,
  nowIso: string,
): CallTask | null {
  const offerable = tasks
    .filter(
      (t) =>
        t.status === "QUEUED" &&
        (t.assignedAgentId === null || t.assignedAgentId === agentId) &&
        isCallbackDue(t, nowIso) &&
        !isRetryBackoffActive(t, nowIso),
    )
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  return offerable[0] ?? null;
}

/**
 * Claim a task (QUEUED -> IN_CALL) for an agent, stamping the assignment
 * time. Pure: returns a new task. Low-level primitive — callers that need
 * assignment enforcement should use claimAssignedTask / claimNextTask.
 */
export function claimTask(task: CallTask, agentId: string, assignedAt?: string): CallTask {
  return {
    ...task,
    status: "IN_CALL",
    assignedAgentId: agentId,
    assignedAt: assignedAt ?? task.assignedAt,
  };
}

export type ClaimNextResult = { tasks: CallTask[]; task: CallTask } | null;

/**
 * Claim-next-task (G3): take the highest-priority UNASSIGNED QUEUED task
 * (priority desc, then oldest; callbacks not yet due are skipped — same
 * ordering as nextTaskForAgent) and assign it to the requesting agent.
 * Returns the full updated task list plus the claimed task, or null when the
 * unassigned pool has nothing offerable right now. Pure — the demo store
 * wrapper (service.ts claimNextTaskInStore) applies the pick-and-replace
 * synchronously, which is what makes the claim atomic in the store.
 */
export function claimNextTask(
  tasks: readonly CallTask[],
  agentId: string,
  nowIso: string,
): ClaimNextResult {
  const pool = tasks.filter((t) => t.assignedAgentId === null);
  const next = nextTaskForAgent(pool, agentId, nowIso);
  if (!next) return null;
  const claimed = claimTask(next, agentId, nowIso);
  return { tasks: tasks.map((t) => (t.id === next.id ? claimed : t)), task: claimed };
}

export type SpecificClaimResult =
  | { ok: true; task: CallTask; alreadyMine: boolean }
  | { ok: false; code: "TASK_ASSIGNED_TO_OTHER" | "TASK_NOT_CLAIMABLE"; error: string };

/**
 * Claim one specific task for an agent (G3). Succeeds when the task is
 * unassigned and QUEUED, or already assigned to this agent (QUEUED -> IN_CALL,
 * or IN_CALL returned unchanged). A task assigned to a DIFFERENT agent is
 * never claimable — not even by a supervisor; supervisors act through the
 * outcome override (checkOutcomeAccess), not by stealing assignments.
 */
export function claimAssignedTask(
  task: CallTask,
  agentId: string,
  nowIso: string,
): SpecificClaimResult {
  if (task.assignedAgentId !== null && task.assignedAgentId !== agentId) {
    return {
      ok: false,
      code: "TASK_ASSIGNED_TO_OTHER",
      error: "Task is assigned to another agent.",
    };
  }
  if (task.assignedAgentId === agentId && task.status === "IN_CALL") {
    return { ok: true, task, alreadyMine: true };
  }
  if (task.status !== "QUEUED") {
    return {
      ok: false,
      code: "TASK_NOT_CLAIMABLE",
      error: `Task is ${task.status} — only a QUEUED task can be claimed.`,
    };
  }
  return { ok: true, task: claimTask(task, agentId, nowIso), alreadyMine: task.assignedAgentId === agentId };
}

export type OutcomeAccess =
  | { allowed: true; supervisorOverride: boolean }
  | { allowed: false; code: "TASK_UNASSIGNED" | "TASK_ASSIGNED_TO_OTHER"; error: string };

/**
 * Assignment gate for recording an outcome (G3). The route resolves
 * `isSupervisor` from the caller's permissions (staff.manage) — this pure
 * function only applies the assignment rules:
 * - assignee recording on their own task -> allowed, no override.
 * - UNASSIGNED task (QUEUED/IN_CALL) -> TASK_UNASSIGNED: claim it first.
 * - task assigned to a DIFFERENT agent -> TASK_ASSIGNED_TO_OTHER, unless the
 *   caller is a supervisor, whose access is allowed and flagged as an
 *   override so recordOutcome can stamp the call log entry.
 * - terminal tasks (DONE/SKIPPED) carry no live assignment to protect, so
 *   they pass through and recordOutcome rejects them with its own error.
 */
export function checkOutcomeAccess(
  task: CallTask,
  agentId: string,
  isSupervisor: boolean,
): OutcomeAccess {
  if (task.status !== "QUEUED" && task.status !== "IN_CALL") {
    return { allowed: true, supervisorOverride: false };
  }
  if (task.assignedAgentId === agentId) {
    return { allowed: true, supervisorOverride: false };
  }
  if (task.assignedAgentId === null) {
    return {
      allowed: false,
      code: "TASK_UNASSIGNED",
      error: "Task is unassigned — claim it before recording an outcome.",
    };
  }
  if (isSupervisor) {
    return { allowed: true, supervisorOverride: true };
  }
  return {
    allowed: false,
    code: "TASK_ASSIGNED_TO_OTHER",
    error: "Task is assigned to another agent.",
  };
}

export type OutcomeResult =
  | { ok: true; task: CallTask; log: CallLogEntry }
  | { ok: false; error: string };

/**
 * Record a call outcome. Rules:
 * - CALLBACK requires a future callbackAt, and the task stays QUEUED with the
 *   callback set (it will be re-offered by nextTaskForAgent when due).
 * - NO_ANSWER re-queues while attempts < MAX_ATTEMPTS, then DONE.
 * - CONFIRMED / CANCELLED / WRONG_NUMBER close the task (DONE).
 * Assignment enforcement is NOT done here — callers must pass the task
 * through checkOutcomeAccess first (G3); meta.supervisorOverride stamps the
 * resulting log entry when a supervisor recorded on another agent's task.
 */
export function recordOutcome(
  task: CallTask,
  input: RecordOutcomeInput,
  meta: { logId: string; agentId: string; calledAt: string; supervisorOverride?: boolean },
): OutcomeResult {
  if (task.status !== "IN_CALL" && task.status !== "QUEUED") {
    return { ok: false, error: `Task is ${task.status} — an outcome cannot be recorded.` };
  }
  if (input.outcome === "CALLBACK") {
    if (!input.callbackAt) return { ok: false, error: "CALLBACK outcome requires callbackAt." };
    if (input.callbackAt <= meta.calledAt) {
      return { ok: false, error: "callbackAt must be in the future." };
    }
  }
  const attempts = task.attempts + 1;
  let status: CallTask["status"] = "DONE";
  let callbackAt: string | undefined;
  if (input.outcome === "CALLBACK") {
    status = "QUEUED";
    callbackAt = input.callbackAt;
  } else if (input.outcome === "NO_ANSWER" && attempts < MAX_ATTEMPTS) {
    status = "QUEUED";
  }
  const updated: CallTask = {
    ...task,
    status,
    attempts,
    lastOutcome: input.outcome,
    callbackAt,
    assignedAgentId: status === "QUEUED" ? task.assignedAgentId : meta.agentId,
  };
  const log: CallLogEntry = {
    id: meta.logId,
    taskId: task.id,
    agentId: meta.agentId,
    outcome: input.outcome,
    ...(meta.supervisorOverride ? { supervisorOverride: true } : {}),
    note: input.note,
    callbackAt: input.outcome === "CALLBACK" ? input.callbackAt : undefined,
    calledAt: meta.calledAt,
    durationSeconds: input.durationSeconds,
  };
  return { ok: true, task: updated, log };
}

/** Callbacks that are due (or overdue) right now, earliest first — the callback list view. */
export function dueCallbacks(tasks: readonly CallTask[], nowIso: string): CallTask[] {
  return tasks
    .filter(
      (t) =>
        t.status === "QUEUED" &&
        t.callbackAt !== undefined &&
        t.callbackAt <= nowIso &&
        // Consistent with the claim paths: a task in no-answer retry
        // backoff is not offered yet, even if an older callback time
        // also makes it look due.
        !isRetryBackoffActive(t, nowIso),
    )
    .sort((a, b) => (a.callbackAt as string).localeCompare(b.callbackAt as string));
}

/**
 * Roll up one agent's performance from the call log. Pure, integer bps
 * rates. ONLY genuine call attempts count: the persisted log also carries
 * rows that are not calls at all — supervisor actions from the C2 console
 * (REASSIGNED / RELEASED / FORCE_CLOSED, stamped with the SUPERVISOR's
 * agentId) and C4 automation rows (AUTO_SMS_*). Those rows reach this
 * function cast to CallLogEntry (outcome is a plain column in the DB), so
 * the rollup filters on the five human CallOutcome values: totalCalls,
 * the confirm-rate denominator and talk time are computed over call rows
 * only, and a supervisor's actions never move any agent's stats.
 */
export function agentPerformance(logs: readonly CallLogEntry[], agentId: string): AgentPerformance {
  const mine = logs.filter((l) => l.agentId === agentId);
  const calls = mine.filter((l) => (CALL_OUTCOMES as readonly string[]).includes(l.outcome));
  const count = (outcome: CallLogEntry["outcome"]): number =>
    calls.filter((l) => l.outcome === outcome).length;
  const confirmed = count("CONFIRMED");
  return {
    agentId,
    totalCalls: calls.length,
    confirmed,
    callbacks: count("CALLBACK"),
    cancelled: count("CANCELLED"),
    noAnswer: count("NO_ANSWER"),
    wrongNumber: count("WRONG_NUMBER"),
    confirmRateBps: calls.length === 0 ? 0 : Math.floor((confirmed * 10_000) / calls.length),
    totalTalkSeconds: calls.reduce((sum, l) => sum + (l.durationSeconds ?? 0), 0),
  };
}

/**
 * Outward view of a task. `phoneMasked` is ALWAYS masked; the full number
 * is added as `phoneFull` only with customers.view_full_phone.
 */
export function toQueueItemView(task: CallTask, canViewFullPhone: boolean): CallTaskView {
  return {
    id: task.id,
    source: task.source,
    orderId: task.orderId,
    orderNo: task.orderNo,
    customerName: task.customerName,
    phoneMasked: maskPhone(task.phone),
    ...(canViewFullPhone ? { phoneFull: task.phone } : {}),
    canViewFullPhone,
    orderTotalPoisha: task.orderTotalPoisha,
    priority: task.priority,
    status: task.status,
    assignedAgentId: task.assignedAgentId,
    assignedAt: task.assignedAt,
    attempts: task.attempts,
    lastOutcome: task.lastOutcome,
    callbackAt: task.callbackAt,
    nextAttemptAt: task.nextAttemptAt,
    note: task.note,
  };
}
