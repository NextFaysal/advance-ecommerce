/**
 * Call-center reporting — Prisma aggregations for a Dhaka-day range.
 *
 * Cohorts (kept deliberately simple so every number can be hand-checked):
 * - TASKS: CallTask rows whose createdAt falls in the range.
 * - LOGS:  CallLogEntry rows whose createdAt falls in the range. One log
 *   row = one call attempt — EXCEPT C4 automation rows (outcome AUTO_*,
 *   agentId null), which share the table but are not call attempts: they
 *   are excluded from the attempt/contact aggregates below, and a task's
 *   final outcome ignores them (an AUTO_SMS_SENT landing after the human
 *   outcome must not become the task's "final outcome").
 * A task's FINAL outcome is its latest (non-automation) log outcome over
 * ALL time (not just the range) — a task created on day 29 and confirmed
 * on day 31 is still a confirmed task. Completion = task status DONE.
 *
 * Metric definitions (rates are integer basis points, floored, exactly
 * like queue.ts agentPerformance; every division is guarded — an empty
 * denominator yields 0, never NaN):
 * - contact rate:      call-attempt logs with outcome NOT IN (NO_ANSWER,
 *                      WRONG_NUMBER) over ALL call-attempt logs in range
 *                      (AUTO_* rows excluded) — "কথা হয়েছে / মোট চেষ্টা".
 * - confirmation rate: PENDING_ORDER tasks created in range, DONE, final
 *                      outcome CONFIRMED — over PENDING_ORDER tasks
 *                      created in range that are DONE.
 * - rescue rate:       same shape for FAILED_DELIVERY tasks. OUTCOME-based
 *                      only: it does not check whether the linked order
 *                      later reached DELIVERED.
 * - callback kept:     CALLBACK logs in range for which the SAME task has
 *                      a CONFIRMED log at a LATER time (any date) — over
 *                      all CALLBACK logs in range.
 * - avg attempts:      sum of the stored attempts counter over DONE tasks
 *                      created in range, over the DONE count (2 decimals).
 *
 * Per-agent rows come from the EXISTING pure agentPerformance() helper
 * (queue.ts) over the range logs; this module only ADDS the fields the
 * helper lacks (callbacks kept + the agent's display name) alongside it.
 * Talk time: CallLogEntry.durationSeconds is persisted at outcome time
 * (C1), selected below and passed through to the helper, so the
 * per-agent totalTalkSeconds here is real.
 */
import { prisma } from "@advance-ecommerce/db";
import { daysAgoInDhaka, dhakaRangeUtc, todayInDhaka } from "../reports/db-rows";
import type { DateRange } from "../reports/types";
import { agentPerformance } from "./queue";
import type {
  AgentPerformance,
  CallLogEntry,
  CallOutcome,
  CallQueueSource,
} from "./types";

export type { DateRange };

const SOURCES: readonly CallQueueSource[] = [
  "PENDING_ORDER",
  "FAILED_DELIVERY",
  "ABANDONED_CHECKOUT",
  "MANUAL",
];

const TERMINAL_FREE_OUTCOMES: ReadonlySet<CallOutcome> = new Set(["NO_ANSWER", "WRONG_NUMBER"]);

/**
 * C4 automation rows (AUTO_SMS_SCHEDULED / AUTO_SMS_SENT / AUTO_SMS_SKIPPED)
 * share CallLogEntry but are not human call attempts — excluded wherever
 * this module counts attempts (headline, by-source, by-hour, final
 * outcome). Prefix match so future AUTO_* kinds are covered too.
 */
const isAutoOutcome = (outcome: string): boolean => outcome.startsWith("AUTO_");

/** Floored basis points, 0 on an empty denominator (never NaN). */
function bps(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.floor((numerator * 10_000) / denominator);
}

export interface SourceReport {
  source: CallQueueSource;
  /** Tasks of this source created in the range. */
  created: number;
  /** Of those, how many are DONE. */
  completed: number;
  /** Of the completed ones, how many ended with final outcome CONFIRMED. */
  confirmedFinal: number;
  /** Log rows in the range belonging to tasks of this source. */
  attempts: number;
}

export interface OutcomePair {
  /** Tasks in the measured cohort (created in range, DONE). */
  completed: number;
  /** Of the cohort, how many ended with final outcome CONFIRMED. */
  confirmed: number;
  rateBps: number;
}

export interface HourBucket {
  /** 0–23, Asia/Dhaka. */
  hour: number;
  attempts: number;
  contacted: number;
}

export interface AgentReport extends AgentPerformance {
  /** Display name from the staff User row, when resolvable. */
  agentName: string | null;
  /** This agent's CALLBACK logs in range later followed by a CONFIRMED
   *  log on the same task. NOT in agentPerformance() — computed here. */
  callbacksKept: number;
  callbackKeptRateBps: number;
}

export interface CallCenterReport {
  range: DateRange;
  tasksCreated: number;
  tasksCompleted: number;
  /** Call-attempt log rows in the range (AUTO_* automation rows excluded). */
  attempts: number;
  contactedAttempts: number;
  contactRateBps: number;
  confirmation: OutcomePair;
  rescue: OutcomePair;
  callbacks: { total: number; kept: number; rateBps: number };
  avgAttemptsPerCompletedTask: number;
  bySource: SourceReport[];
  byHour: HourBucket[];
  agents: AgentReport[];
}

/** Default range: the last 30 Dhaka days, today included. */
export function defaultReportRange(): DateRange {
  return { from: daysAgoInDhaka(29), to: todayInDhaka() };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate + normalize a from/to pair; null when unusable. */
export function parseReportRange(from?: string, to?: string): DateRange | null {
  if (from === undefined && to === undefined) return defaultReportRange();
  const f = from ?? daysAgoInDhaka(29);
  const t = to ?? todayInDhaka();
  if (!DATE_RE.test(f) || !DATE_RE.test(t)) return null;
  if (Number.isNaN(Date.parse(f)) || Number.isNaN(Date.parse(t))) return null;
  if (f > t) return null;
  // Bound the query cost: at most ~a year of rows.
  const spanDays = (Date.parse(t) - Date.parse(f)) / 86_400_000;
  if (spanDays > 366) return null;
  return { from: f, to: t };
}

const dhakaHourFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dhaka",
  hour: "2-digit",
  hourCycle: "h23",
});

function dhakaHourOf(instant: Date): number {
  return Number(dhakaHourFmt.format(instant)) % 24;
}

export async function getCallCenterReport(range: DateRange): Promise<CallCenterReport> {
  const { gte, lte } = dhakaRangeUtc(range);

  const [taskRows, logRows] = await Promise.all([
    prisma.callTask.findMany({
      where: { createdAt: { gte, lte } },
      orderBy: { createdAt: "asc" },
      select: { id: true, kind: true, status: true, attempts: true },
    }),
    prisma.callLogEntry.findMany({
      where: { createdAt: { gte, lte } },
      orderBy: { createdAt: "asc" },
      select: { id: true, taskId: true, agentId: true, outcome: true, note: true, durationSeconds: true, createdAt: true },
    }),
  ]);

  const kindOf = (kind: string): CallQueueSource =>
    (SOURCES as readonly string[]).includes(kind) ? (kind as CallQueueSource) : "MANUAL";
  const taskById = new Map(taskRows.map((t) => [t.id, t]));

  // Logs may belong to tasks created BEFORE the range — resolve their
  // kinds too (one bounded extra query), so by-source attempt counts
  // cover every log in the range.
  const foreignTaskIds = [
    ...new Set(logRows.map((l) => l.taskId).filter((id) => !taskById.has(id))),
  ];
  if (foreignTaskIds.length > 0) {
    const foreign = await prisma.callTask.findMany({
      where: { id: { in: foreignTaskIds } },
      select: { id: true, kind: true, status: true, attempts: true },
    });
    for (const t of foreign) taskById.set(t.id, t);
  }

  // Final outcome per task in the TASKS cohort: latest log over all time.
  const cohortIds = taskRows.map((t) => t.id);
  const finalOutcomeByTask = new Map<string, CallOutcome>();
  if (cohortIds.length > 0) {
    const allLogs = await prisma.callLogEntry.findMany({
      where: { taskId: { in: cohortIds } },
      orderBy: { createdAt: "desc" },
      select: { taskId: true, outcome: true },
    });
    for (const l of allLogs) {
      if (isAutoOutcome(l.outcome)) continue; // automation rows are never a task's final outcome
      if (!finalOutcomeByTask.has(l.taskId)) {
        finalOutcomeByTask.set(l.taskId, l.outcome as CallOutcome);
      }
    }
  }

  // Callback-kept: a CONFIRMED log exists on the same task AFTER the
  // callback log (the confirming log may sit outside the range).
  const callbackLogs = logRows.filter((l) => l.outcome === "CALLBACK");
  const laterConfirmedByTask = new Map<string, Date[]>();
  if (callbackLogs.length > 0) {
    const cbTaskIds = [...new Set(callbackLogs.map((l) => l.taskId))];
    const confirms = await prisma.callLogEntry.findMany({
      where: { taskId: { in: cbTaskIds }, outcome: "CONFIRMED" },
      select: { taskId: true, createdAt: true },
    });
    for (const c of confirms) {
      const arr = laterConfirmedByTask.get(c.taskId) ?? [];
      arr.push(c.createdAt);
      laterConfirmedByTask.set(c.taskId, arr);
    }
  }
  const isKept = (taskId: string, after: Date): boolean =>
    (laterConfirmedByTask.get(taskId) ?? []).some((d) => d.getTime() > after.getTime());
  const callbacksKept = callbackLogs.filter((l) => isKept(l.taskId, l.createdAt)).length;

  // ---- headline metrics -------------------------------------------------
  // Attempts/contact are counted over call-attempt rows only — C4
  // automation rows (AUTO_*) are not call attempts.
  const attemptLogs = logRows.filter((l) => !isAutoOutcome(l.outcome));
  const attempts = attemptLogs.length;
  const contactedAttempts = attemptLogs.filter(
    (l) => !TERMINAL_FREE_OUTCOMES.has(l.outcome as CallOutcome),
  ).length;

  const completedTasks = taskRows.filter((t) => t.status === "DONE");
  const pairFor = (source: CallQueueSource): OutcomePair => {
    const cohort = completedTasks.filter((t) => kindOf(t.kind) === source);
    const confirmed = cohort.filter((t) => finalOutcomeByTask.get(t.id) === "CONFIRMED").length;
    return { completed: cohort.length, confirmed, rateBps: bps(confirmed, cohort.length) };
  };

  const attemptsOnCompleted = completedTasks.reduce((s, t) => s + t.attempts, 0);

  // ---- by source ----------------------------------------------------------
  const bySource: SourceReport[] = SOURCES.map((source) => {
    const created = taskRows.filter((t) => kindOf(t.kind) === source);
    const completed = created.filter((t) => t.status === "DONE");
    return {
      source,
      created: created.length,
      completed: completed.length,
      confirmedFinal: completed.filter((t) => finalOutcomeByTask.get(t.id) === "CONFIRMED").length,
      attempts: attemptLogs.filter((l) => {
        const t = taskById.get(l.taskId);
        return t !== undefined && kindOf(t.kind) === source;
      }).length,
    };
  });

  // ---- by hour (Dhaka) ----------------------------------------------------
  const byHour: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    attempts: 0,
    contacted: 0,
  }));
  for (const l of attemptLogs) {
    const bucket = byHour[dhakaHourOf(l.createdAt)] as HourBucket;
    bucket.attempts += 1;
    if (!TERMINAL_FREE_OUTCOMES.has(l.outcome as CallOutcome)) bucket.contacted += 1;
  }

  // ---- per agent ------------------------------------------------------------
  const logsAsEntries: CallLogEntry[] = logRows.map((l) => ({
    id: l.id,
    taskId: l.taskId,
    agentId: l.agentId ?? "",
    outcome: l.outcome as CallOutcome,
    note: l.note ?? undefined,
    durationSeconds: l.durationSeconds ?? undefined,
    calledAt: l.createdAt.toISOString(),
  }));
  const agentIds = [...new Set(logsAsEntries.map((l) => l.agentId).filter((a) => a !== ""))];
  const users = agentIds.length
    ? await prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name ?? u.email ?? null]));
  const agents: AgentReport[] = agentIds
    .map((agentId) => {
      const perf = agentPerformance(logsAsEntries, agentId);
      const kept = callbackLogs.filter(
        (l) => l.agentId === agentId && isKept(l.taskId, l.createdAt),
      ).length;
      return {
        ...perf,
        agentName: nameById.get(agentId) ?? null,
        callbacksKept: kept,
        callbackKeptRateBps: bps(kept, perf.callbacks),
      };
    })
    .sort((a, b) => b.totalCalls - a.totalCalls);

  return {
    range,
    tasksCreated: taskRows.length,
    tasksCompleted: completedTasks.length,
    attempts,
    contactedAttempts,
    contactRateBps: bps(contactedAttempts, attempts),
    confirmation: pairFor("PENDING_ORDER"),
    rescue: pairFor("FAILED_DELIVERY"),
    callbacks: {
      total: callbackLogs.length,
      kept: callbacksKept,
      rateBps: bps(callbacksKept, callbackLogs.length),
    },
    avgAttemptsPerCompletedTask:
      completedTasks.length === 0
        ? 0
        : Math.round((attemptsOnCompleted / completedTasks.length) * 100) / 100,
    bySource,
    byHour,
    agents,
  };
}

/* ------------------------------------------------------------------ */
/* CSV export (moved from the reports/export route — route files may  */
/* only export handlers, so the builder lives with the report code)   */
/* ------------------------------------------------------------------ */

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Basis points -> "66.67%" (trimmed), for human-readable CSV cells. */
function pct(bpsValue: number): string {
  const v = (bpsValue / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${v === "" ? "0" : v}%`;
}

export function buildCsv(report: CallCenterReport, meta: { exportedBy: string; reason: string; now: Date }): string {
  const lines: string[] = [
    "# CALL CENTER REPORT EXPORT — Advance Ecommerce",
    `# exported-by: ${meta.exportedBy}`,
    `# exported-at: ${dhakaTimestamp(meta.now)} (Asia/Dhaka)`,
    `# reason: ${meta.reason.replace(/\n/g, " ")}`,
    `# range: ${report.range.from}..${report.range.to} (Asia/Dhaka days)`,
    "",
    "summary_metric,value",
    ...(
      [
        ["tasks_created", report.tasksCreated],
        ["tasks_completed", report.tasksCompleted],
        ["call_attempts", report.attempts],
        ["contacted_attempts", report.contactedAttempts],
        ["contact_rate", pct(report.contactRateBps)],
        ["confirmation_completed", report.confirmation.completed],
        ["confirmation_confirmed", report.confirmation.confirmed],
        ["confirmation_rate", pct(report.confirmation.rateBps)],
        ["rescue_completed", report.rescue.completed],
        ["rescue_confirmed", report.rescue.confirmed],
        ["rescue_rate", pct(report.rescue.rateBps)],
        ["callbacks_total", report.callbacks.total],
        ["callbacks_kept", report.callbacks.kept],
        ["callback_kept_rate", pct(report.callbacks.rateBps)],
        ["avg_attempts_per_completed_task", report.avgAttemptsPerCompletedTask],
      ] as [string, string | number][]
    ).map(([k, v]) => `${csvCell(k)},${csvCell(v)}`),
    "",
    "agentId,agentName,totalCalls,confirmed,callbacks,cancelled,noAnswer,wrongNumber,confirmRate,callbacksKept,callbackKeptRate,totalTalkSeconds",
    ...report.agents.map((a) =>
      [
        a.agentId,
        a.agentName,
        a.totalCalls,
        a.confirmed,
        a.callbacks,
        a.cancelled,
        a.noAnswer,
        a.wrongNumber,
        pct(a.confirmRateBps),
        a.callbacksKept,
        pct(a.callbackKeptRateBps),
        a.totalTalkSeconds,
      ]
        .map(csvCell)
        .join(","),
    ),
  ];
  return lines.join("\n");
}
