/**
 * Scheduled report delivery — ADV-8 (doc 22).
 *
 * A saved report (src/reports/saved-reports.ts) can be scheduled
 * daily/weekly (Dhaka time). When a schedule is due, this service
 * enqueues ONE email job per recipient on the existing email-send
 * queue (ADV-3's producer seam — enqueueEmailJob). The job carries
 * ids + the period range ONLY; the worker's send path
 * (processEmailJob, templateKey "report_delivery") rebuilds the CSV
 * at send time and attaches it — the same ids-only discipline as the
 * order-confirmation job.
 *
 * WHO CALLS THIS: there is no always-on scheduler until the worker
 * host (ADV-1) runs a tick, so the trigger today is the admin
 * run-due route (POST /api/v1/admin/reports/builder/schedules/run-due)
 * — and tomorrow the worker tick calls the same function. A schedule
 * is marked sent ONLY when every recipient's job actually queued;
 * queue-unavailable leaves it due (visible, retryable), never faked.
 *
 * PERIODS (the scheduled export always covers a COMPLETED period):
 *   daily  -> yesterday (Dhaka), periodKey = that date
 *   weekly -> the 7 Dhaka days ending yesterday, fired on the
 *             schedule's weekday, periodKey = "7d-ending-<yesterday>"
 */
import type { DateRange } from "./types";
import type { ReportSchedule, SavedReport } from "./saved-reports";
import { listReportSchedules, listSavedReports, markScheduleSent, type KeyValueStore } from "./saved-reports";
import type { EmailJob } from "../jobs/queues";

export interface DhakaNow {
  /** YYYY-MM-DD in Asia/Dhaka. */
  date: string;
  /** 0 = Sunday … 6 = Saturday, in Asia/Dhaka. */
  weekday: number;
  /** Minutes since Dhaka midnight. */
  minutes: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function dhakaNowParts(now: Date): DhakaNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return {
    date,
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y as number, (m as number) - 1, d as number) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The completed period a schedule run covers, + its dedupe key. */
export function schedulePeriod(schedule: ReportSchedule, now: DhakaNow): { range: DateRange; periodKey: string } {
  const yesterday = shiftDate(now.date, -1);
  if (schedule.cadence === "daily") {
    return { range: { from: yesterday, to: yesterday }, periodKey: yesterday };
  }
  return { range: { from: shiftDate(yesterday, -6), to: yesterday }, periodKey: `7d-ending-${yesterday}` };
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Due = enabled, at/after the Dhaka time, (weekly: today's the
 *  weekday), and this period not already sent. */
export function isScheduleDue(schedule: ReportSchedule, now: DhakaNow): boolean {
  if (!schedule.enabled) return false;
  if (now.minutes < timeToMinutes(schedule.time)) return false;
  if (schedule.cadence === "weekly" && schedule.weekday !== null && schedule.weekday !== now.weekday) return false;
  const { periodKey } = schedulePeriod(schedule, now);
  return schedule.lastPeriodKey !== periodKey;
}

export interface ScheduleRunDeps {
  store: KeyValueStore;
  enqueue: (job: EmailJob, jobName: string) => Promise<{ email: "queued" | "not_queued"; reason?: string }>;
  now: Date;
  actorId: string;
}

export interface ScheduleRunOutcome {
  scheduleId: string;
  reportId: string;
  outcome: "queued" | "not_queued" | "skipped";
  detail: string;
  periodKey?: string;
}

/**
 * Evaluate every schedule once: enqueue delivery jobs for the due
 * ones and mark them sent only when ALL recipients queued. Returns
 * one outcome per schedule (due or not) so callers can show exactly
 * what happened — nothing is silently dropped.
 */
export async function runDueReportSchedules(deps: ScheduleRunDeps): Promise<ScheduleRunOutcome[]> {
  const nowParts = dhakaNowParts(deps.now);
  const [schedules, reports] = await Promise.all([
    listReportSchedules(deps.store),
    listSavedReports(deps.store),
  ]);
  const reportById = new Map<string, SavedReport>(reports.map((r) => [r.id, r]));
  const outcomes: ScheduleRunOutcome[] = [];

  for (const schedule of schedules) {
    if (!isScheduleDue(schedule, nowParts)) {
      outcomes.push({ scheduleId: schedule.id, reportId: schedule.reportId, outcome: "skipped", detail: "not due" });
      continue;
    }
    const report = reportById.get(schedule.reportId);
    if (report === undefined) {
      outcomes.push({ scheduleId: schedule.id, reportId: schedule.reportId, outcome: "skipped", detail: "saved report no longer exists" });
      continue;
    }
    const { range, periodKey } = schedulePeriod(schedule, nowParts);
    let allQueued = true;
    let firstReason = "";
    for (const recipient of schedule.recipients) {
      const job: EmailJob = {
        templateKey: "report_delivery",
        recipientRef: schedule.id,
        toEmail: recipient,
        reportId: report.id,
        scheduleId: schedule.id,
        reportPeriodFrom: range.from,
        reportPeriodTo: range.to,
        idempotencyKey: `report-delivery-${schedule.id}-${periodKey}-${recipient}`,
      };
      const result = await deps.enqueue(job, "report-delivery-email");
      if (result.email !== "queued") {
        allQueued = false;
        firstReason = result.reason ?? "queue-unavailable";
      }
    }
    if (allQueued) {
      await markScheduleSent(deps.store, schedule.id, deps.now.toISOString(), periodKey, deps.actorId);
      outcomes.push({ scheduleId: schedule.id, reportId: schedule.reportId, outcome: "queued", detail: `delivery queued for ${schedule.recipients.length} recipient(s)`, periodKey });
    } else {
      outcomes.push({ scheduleId: schedule.id, reportId: schedule.reportId, outcome: "not_queued", detail: firstReason, periodKey });
    }
  }
  return outcomes;
}
