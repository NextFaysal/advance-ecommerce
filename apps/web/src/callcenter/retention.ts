/**
 * Call-center data retention (C7 hardening — plan doc 15, item R6.2).
 *
 * Call records accumulate free text that can contain PII: a log's
 * `note` / `qaComment` may quote a phone number or a name, and a
 * MANUAL task persists the customer's full phone + name + note on the
 * task row itself (C1). Once a record is older than the retention
 * window those fields are anonymized — the structured data (outcome,
 * disposition, QA score, duration, timestamps, task kind/status,
 * masked phone, order link) is KEPT, so C5 reporting and
 * agentPerformance history survive intact; only free text and the
 * stored full-PII fields are scrubbed.
 *
 * Window: Settings key `call_center.log_retention_months` (registered
 * default "12"). The cutoff is `now` minus that many CALENDAR months,
 * computed in UTC (timestamps are stored in UTC; no Dhaka alignment is
 * needed for a months-scale policy — said plainly so nobody assumes
 * otherwise).
 *
 * "Older" is judged by `createdAt` on both tables — CallTask has no
 * updatedAt column, and a log's creation time is when its text was
 * written. Tasks are only scrubbed in terminal states (DONE /
 * SKIPPED): a still-open task keeps its number/name whatever its age,
 * because an agent may still have to work it.
 *
 * Scheduling: this module is invoked by `scripts/callcenter-retention.ts`
 * today and by a worker/cron job once the VPS worker host exists
 * (doc 15 R4) — the function itself is the whole policy.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";

const BATCH_SIZE = 500;
const DEFAULT_RETENTION_MONTHS = 12;

export interface RetentionResult {
  /** Log rows whose note/qaComment were nulled (or would be, dry run). */
  logsScrubbed: number;
  /** Terminal task rows whose note/customerPhone/customerName were nulled. */
  tasksScrubbed: number;
  /** Rows older than this instant were eligible. */
  cutoff: Date;
  /** The window actually applied (months), after fallback. */
  retentionMonths: number;
  dryRun: boolean;
}

/** `now` minus `months` calendar months (UTC), clamping the day to the
 *  target month's length (e.g. Mar 31 − 1 month → Feb 28/29). */
export function minusCalendarMonths(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d;
}

async function resolveRetentionMonths(): Promise<number> {
  const raw = await getSetting("call_center.log_retention_months");
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_RETENTION_MONTHS;
}

/**
 * Anonymize expired call data. With `dryRun: true` nothing is written
 * and the returned counts are what a real run WOULD scrub. Updates are
 * batched (500 rows per pass) so the job is safe on large tables; a
 * scrubbed row no longer matches its own selection filter, so the
 * batch loop always terminates.
 */
export async function anonymizeExpiredCallData(
  now: Date,
  opts: { dryRun: boolean },
): Promise<RetentionResult> {
  const retentionMonths = await resolveRetentionMonths();
  const cutoff = minusCalendarMonths(now, retentionMonths);
  const { dryRun } = opts;

  // Logs: expired AND still carrying free text in either field.
  const logWhere = {
    createdAt: { lt: cutoff },
    OR: [{ note: { not: null } }, { qaComment: { not: null } }],
  };

  // Tasks: expired, terminal, AND still carrying any scrubbed field.
  const taskWhere = {
    createdAt: { lt: cutoff },
    status: { in: ["DONE", "SKIPPED"] },
    OR: [{ note: { not: null } }, { customerPhone: { not: null } }, { customerName: { not: null } }],
  };

  let logsScrubbed = 0;
  let tasksScrubbed = 0;

  if (dryRun) {
    logsScrubbed = await prisma.callLogEntry.count({ where: logWhere });
    tasksScrubbed = await prisma.callTask.count({ where: taskWhere });
  } else {
    for (;;) {
      const batch = await prisma.callLogEntry.findMany({
        where: logWhere,
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;
      const res = await prisma.callLogEntry.updateMany({
        where: { id: { in: batch.map((r) => r.id) } },
        data: { note: null, qaComment: null },
      });
      logsScrubbed += res.count;
    }
    for (;;) {
      const batch = await prisma.callTask.findMany({
        where: taskWhere,
        select: { id: true },
        take: BATCH_SIZE,
      });
      if (batch.length === 0) break;
      const res = await prisma.callTask.updateMany({
        where: { id: { in: batch.map((r) => r.id) } },
        data: { note: null, customerPhone: null, customerName: null },
      });
      tasksScrubbed += res.count;
    }
  }

  return { logsScrubbed, tasksScrubbed, cutoff, retentionMonths, dryRun };
}
