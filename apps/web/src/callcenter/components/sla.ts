/**
 * Call-center SLA language — CD0 (doc 20 §2).
 *
 * ONE pure helper decides whether a task is inside its SLA, due soon,
 * or overdue, so the workbench queue, the callbacks strip and the
 * supervisor board never grow their own copies of the rule. The
 * definitions are NOT new — they mirror the supervisor board
 * (src/callcenter/supervisor-store.ts), which is the module's SLA
 * authority:
 *
 *  - Thresholds come from Settings (getSlaThresholds there):
 *    `call_center.sla_confirm_minutes` (default 30) for PENDING_ORDER,
 *    `call_center.sla_rescue_minutes` (default 60) for FAILED_DELIVERY.
 *    Callers pass the resolved thresholds in — this helper never reads
 *    Settings itself (it stays pure and testable).
 *  - CALLBACK overdue (board `dueCallbacks` in loadSupervisorBoard;
 *    queue.ts `dueCallbacks`; workbench overdue highlight): an OPEN
 *    task (QUEUED / IN_CALL) whose callbackAt is in the past.
 *  - AGE breach (board `slaBreaches`): an OPEN task with attempts = 0
 *    whose age (floor minutes since createdAt) exceeds its source
 *    threshold — confirmMinutes for PENDING_ORDER, rescueMinutes for
 *    FAILED_DELIVERY. Only those two sources carry an age SLA; a
 *    closed task (DONE / SKIPPED) is history and can never breach.
 *
 * The "due" (due-soon) state is the one CD0 addition: the board only
 * distinguishes breach / no-breach, but a chip that flips straight
 * from ok to overdue is useless for a scheduled callback. A callback
 * falling inside the next `confirmMinutes` window (the Settings
 * confirm threshold — the module's own "act soon" unit, reused rather
 * than a new magic constant) reads "due". Age-rule tasks have no
 * due-soon state: they are "ok" until the board's breach line, then
 * "overdue", exactly like the board.
 */
import type { CallQueueSource, CallTaskStatus } from "../types";

/** Resolved SLA thresholds (minutes), as returned by the board's
 *  getSlaThresholds() in supervisor-store.ts. */
export interface SlaThresholds {
  confirmMinutes: number;
  rescueMinutes: number;
}

export type SlaState = "ok" | "due" | "overdue";

/** Structural minimum of a task the helper can judge. Both real views
 *  (CallTaskView in types.ts, SupervisorTaskView in supervisor-store.ts)
 *  satisfy it; `attempts` is optional only so a caller that genuinely
 *  lacks it can omit it — omit = unattempted, matching the board's
 *  attempts = 0 gate. Every real view carries attempts, so real
 *  callers always pass it. */
export interface SlaTaskLike {
  status: CallTaskStatus;
  source: CallQueueSource;
  createdAt?: string;
  callbackAt?: string;
  attempts?: number;
}

const OPEN_STATUSES: readonly CallTaskStatus[] = ["QUEUED", "IN_CALL"];

/**
 * The task's SLA state at `now`, or null when no SLA applies:
 * closed tasks, open MANUAL / ABANDONED_CHECKOUT tasks with no
 * callback scheduled, and already-attempted order tasks with no
 * callback scheduled (the board never age-breaches those).
 *
 * Rule order: a scheduled callback is the operative deadline and is
 * judged first (in the real flow a task only gains a callbackAt by
 * being attempted, so the two rules never genuinely compete).
 */
export function slaStateForTask(
  task: SlaTaskLike,
  now: Date,
  thresholds: SlaThresholds,
): SlaState | null {
  if (!OPEN_STATUSES.includes(task.status)) return null;
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return null;

  // Callback deadline — board dueCallbacks / workbench overdue rule.
  if (task.callbackAt) {
    const callbackMs = Date.parse(task.callbackAt);
    if (Number.isFinite(callbackMs)) {
      if (callbackMs < nowMs) return "overdue";
      if (callbackMs - nowMs <= thresholds.confirmMinutes * 60_000) return "due";
      return "ok";
    }
    // An unparseable callbackAt cannot be judged; fall through to the
    // age rule rather than pretending the task is fine.
  }

  // Unattempted-age breach — board slaBreaches rule, verbatim gates.
  if ((task.attempts ?? 0) !== 0) return null;
  const thresholdMinutes =
    task.source === "PENDING_ORDER"
      ? thresholds.confirmMinutes
      : task.source === "FAILED_DELIVERY"
        ? thresholds.rescueMinutes
        : null;
  if (thresholdMinutes === null) return null;
  const createdMs = Date.parse(task.createdAt ?? "");
  if (!Number.isFinite(createdMs)) return null;
  const ageMinutes = Math.floor((nowMs - createdMs) / 60_000);
  return ageMinutes > thresholdMinutes ? "overdue" : "ok";
}
