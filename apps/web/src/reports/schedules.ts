/**
 * Scheduled report delivery — production facade + worker entry
 * point (ADV-8 remainder, doc 22; wave 52).
 *
 * WHAT ALREADY EXISTED (wave 38, unchanged by this module):
 *   - Storage: the `reports.schedules` Setting document and its
 *     zod schema live in src/reports/saved-reports.ts, next to the
 *     saved definitions a schedule points at. ONE schema, ONE doc —
 *     this module delegates to those helpers and never writes a
 *     competing shape to the key (a second shape would fail the
 *     stored doc's validation and silently empty the list).
 *   - Due logic + enqueue fan-out: src/reports/schedule-delivery.ts
 *     (runDueReportSchedules, deps-injected).
 *   - Send path: processEmailJob's "report_delivery" case
 *     (src/email/send.ts) rebuilds the CSV from the saved definition
 *     for the job's period and attaches it — attachments are REAL:
 *     EmailProvider.send accepts attachments and the Resend adapter
 *     maps them into its payload (src/integrations/email-resend.ts).
 *
 * WHAT THIS MODULE ADDS:
 *   - CRUD helpers over the doc for the top-level admin API
 *     (app/api/v1/admin/reports/schedules) — list-as-views and a
 *     validated replace-all write (cap: MAX_REPORT_SCHEDULES = 20).
 *   - processDueReportSchedules(now): the production-composed sweep
 *     (Prisma store + enqueueEmailJob), callable unchanged by the
 *     future worker tick — until ADV-1's worker host exists, the
 *     only trigger is the admin run-due route, which composes the
 *     same runDueReportSchedules with the caller's user id.
 *
 * FIELD MAPPING (stored ReportSchedule -> the view this module
 * returns): name = the linked saved report's current name ("" when
 * the report was deleted; delivery then skips honestly),
 * reportKey = reportId (the saved report's id — its definition
 * carries the builder dataset/columns/filters), format = "csv"
 * (constant: the report_delivery job/send contract carries CSV
 * only. A PDF renderer exists as a library — renderReportPdf in
 * src/pdf/report — but no PDF variant rides the email pipeline, so
 * none is offered here), lastRunAt = lastSentAt.
 *
 * DUE SEMANTICS (schedule-delivery.ts, kept — not re-implemented):
 * a schedule fires for a COMPLETED Dhaka period (daily: yesterday;
 * weekly: the 7 days ending yesterday) once the Dhaka clock passes
 * the schedule's time (weekly: only on its weekday; a null weekday
 * means any day, the pre-existing semantic). The periodKey dedupe
 * (lastPeriodKey) is what enforces spacing: a daily schedule cannot
 * send twice for the same yesterday, and a weekly schedule's sends
 * land ≥7 days apart in practice because the weekday anchor repeats
 * weekly. lastSentAt advances ONLY when every recipient's email
 * job actually queued — queue-unavailable leaves the schedule due
 * (visible, retryable), never faked. Per-schedule failures are
 * isolated: one bad schedule never blocks the others, and every
 * schedule produces an outcome row.
 *
 * HONESTY: queued is NOT sent. Delivery still needs the worker
 * process (VPS, ADV-1) and a configured email transport (ADV-3).
 */
import { z } from "zod";
import {
  REPORT_SCHEDULES_KEY,
  listReportSchedules,
  listSavedReports,
  prismaKeyValueStore,
  type KeyValueStore,
  type ReportSchedule,
} from "./saved-reports";
import { runDueReportSchedules, type ScheduleRunOutcome } from "./schedule-delivery";
import { enqueueEmailJob } from "../email/send";

export const MAX_REPORT_SCHEDULES = 20;

/** Actor stamped on Setting writes made by the unattended sweep. */
export const REPORT_SCHEDULE_SYSTEM_ACTOR = "system:report-schedules";

/** Stored schedule + the display fields the admin surfaces use. */
export interface ReportScheduleView extends ReportSchedule {
  /** Linked saved report's current name ("" when it was deleted). */
  name: string;
  /** Alias of reportId — the builder identifier of the report. */
  reportKey: string;
  /** The only format the email pipeline delivers (see header). */
  format: "csv";
  /** Alias of lastSentAt. */
  lastRunAt: string | null;
}

export function toScheduleView(schedule: ReportSchedule, reportName: string): ReportScheduleView {
  return {
    ...schedule,
    name: reportName,
    reportKey: schedule.reportId,
    format: "csv",
    lastRunAt: schedule.lastSentAt,
  };
}

/** Schedules as views, with names resolved from the saved reports. */
export async function listScheduleViews(
  store: KeyValueStore = prismaKeyValueStore(),
): Promise<ReportScheduleView[]> {
  const [schedules, reports] = await Promise.all([
    listReportSchedules(store),
    listSavedReports(store),
  ]);
  const nameOf = new Map(reports.map((r) => [r.id, r.name]));
  return schedules.map((s) => toScheduleView(s, nameOf.get(s.reportId) ?? ""));
}

/* ------------------------------------------------------------------ */
/* Replace-all write (the top-level API's PUT)                         */
/* ------------------------------------------------------------------ */

/** The client-editable fields of one schedule. `reportKey` is
 *  accepted as an alias of `reportId` and normalised on parse. */
export const scheduleInputSchema = z.object({
  id: z.string().min(1).optional(),
  reportId: z.string().min(1).optional(),
  reportKey: z.string().min(1).optional(),
  cadence: z.enum(["daily", "weekly"]),
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  recipients: z.array(z.string().email()).min(1).max(10),
  enabled: z.boolean().default(true),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export function parseScheduleInputs(
  input: unknown,
): { ok: true; inputs: ScheduleInput[] } | { ok: false; message: string } {
  if (!Array.isArray(input)) return { ok: false, message: "schedules must be an array." };
  if (input.length > MAX_REPORT_SCHEDULES) {
    return { ok: false, message: `At most ${MAX_REPORT_SCHEDULES} schedules are allowed.` };
  }
  const parsed = z.array(scheduleInputSchema).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  for (const item of parsed.data) {
    if ((item.reportId ?? item.reportKey) === undefined) {
      return { ok: false, message: "Every schedule needs a reportId (reportKey)." };
    }
  }
  return { ok: true, inputs: parsed.data };
}

/**
 * Replace the whole schedules doc with the validated inputs.
 * Server-owned fields are preserved for ids that already exist
 * (lastSentAt / lastPeriodKey — wiping them would re-send periods;
 * createdBy / createdAt); new entries mint an id + timestamps.
 * The doc is written through the same Setting store the builder
 * routes use, so both APIs always see one list.
 */
export async function replaceSchedules(
  inputs: ScheduleInput[],
  actorId: string,
  store: KeyValueStore = prismaKeyValueStore(),
): Promise<ReportScheduleView[]> {
  const existing = await listReportSchedules(store);
  const byId = new Map(existing.map((s) => [s.id, s]));
  const nowIso = new Date().toISOString();
  const next: ReportSchedule[] = inputs.map((input) => {
    const prior = input.id !== undefined ? byId.get(input.id) : undefined;
    return {
      id: prior?.id ?? crypto.randomUUID(),
      reportId: (input.reportId ?? input.reportKey) as string,
      cadence: input.cadence,
      weekday: input.cadence === "weekly" ? input.weekday : null,
      time: input.time,
      recipients: input.recipients,
      enabled: input.enabled,
      lastSentAt: prior?.lastSentAt ?? null,
      lastPeriodKey: prior?.lastPeriodKey ?? null,
      createdBy: prior?.createdBy ?? actorId,
      createdAt: prior?.createdAt ?? nowIso,
    };
  });
  await store.write(REPORT_SCHEDULES_KEY, JSON.stringify({ version: 1, schedules: next }), actorId);
  const reports = await listSavedReports(store);
  const nameOf = new Map(reports.map((r) => [r.id, r.name]));
  return next.map((s) => toScheduleView(s, nameOf.get(s.reportId) ?? ""));
}

/* ------------------------------------------------------------------ */
/* Worker entry point                                                  */
/* ------------------------------------------------------------------ */

export interface ProcessDueReportSchedulesResult {
  outcomes: ScheduleRunOutcome[];
  summary: { queued: number; notQueued: number; skipped: number };
}

/**
 * Evaluate every schedule once against `now` and enqueue delivery
 * email jobs for the due ones. This is the function the worker
 * tick calls (see the wiring notes in the wave-52 report); the
 * admin run-due route performs the same composition per request.
 */
export async function processDueReportSchedules(
  now: Date,
  actorId: string = REPORT_SCHEDULE_SYSTEM_ACTOR,
): Promise<ProcessDueReportSchedulesResult> {
  const outcomes = await runDueReportSchedules({
    store: prismaKeyValueStore(),
    enqueue: (job, name) => enqueueEmailJob(job, name),
    now,
    actorId,
  });
  return {
    outcomes,
    summary: {
      queued: outcomes.filter((o) => o.outcome === "queued").length,
      notQueued: outcomes.filter((o) => o.outcome === "not_queued").length,
      skipped: outcomes.filter((o) => o.outcome === "skipped").length,
    },
  };
}
