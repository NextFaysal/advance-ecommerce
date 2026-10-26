/**
 * Saved report definitions + delivery schedules — ADV-8 (doc 22).
 *
 * Persistence follows the established JSON-document pattern
 * (src/cms/site-content.ts, src/callcenter/scripts-store.ts): one
 * zod-validated JSON document per Setting key, written with
 * prisma.setting.upsert — NO new table, no migration. Documents:
 *   reports.saved_definitions -> { version: 1, reports: SavedReport[] }
 *   reports.schedules         -> { version: 1, schedules: ReportSchedule[] }
 * The low-level key/value store is injectable so the logic is
 * smoke-testable without a DB; production uses the Prisma store.
 */
import { z } from "zod";
import { reportDefinitionSchema, type ReportDefinition } from "./builder";

export const SAVED_REPORTS_KEY = "reports.saved_definitions";
export const REPORT_SCHEDULES_KEY = "reports.schedules";

export const savedReportSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  definition: reportDefinitionSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type SavedReport = z.infer<typeof savedReportSchema>;

export const reportScheduleSchema = z.object({
  id: z.string().min(1),
  reportId: z.string().min(1),
  cadence: z.enum(["daily", "weekly"]),
  /** Dhaka weekday for weekly cadence: 0 = Sunday … 6 = Saturday. */
  weekday: z.number().int().min(0).max(6).nullable().default(null),
  /** Dhaka local time "HH:MM" the report is generated at/after. */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  recipients: z.array(z.string().email()).min(1).max(10),
  enabled: z.boolean().default(true),
  /** ISO instant of the last successful enqueue; null = never sent. */
  lastSentAt: z.string().nullable().default(null),
  /** Period key of the last send ("2026-10-25" / "2026-W43") — with
   *  the email idempotency key this makes re-runs safe. */
  lastPeriodKey: z.string().nullable().default(null),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
});
export type ReportSchedule = z.infer<typeof reportScheduleSchema>;

const savedDocSchema = z.object({ version: z.literal(1), reports: z.array(savedReportSchema) });
const schedulesDocSchema = z.object({ version: z.literal(1), schedules: z.array(reportScheduleSchema) });
type SavedReportsDoc = z.infer<typeof savedDocSchema>;
type ReportSchedulesDoc = z.infer<typeof schedulesDocSchema>;

export interface KeyValueStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store over the Setting table (prisma imported lazily —
 *  the return-notify pattern — so importing this module never drags
 *  the DB client into pure-logic consumers/tests). */
export function prismaKeyValueStore(): KeyValueStore {
  return {
    async read(key) {
      const { prisma } = await import("@advance-ecommerce/db");
      const row = await prisma.setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Report builder document (JSON, ADV-8)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

async function readDoc<T>(store: KeyValueStore, key: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, empty: T): Promise<T> {
  const raw = await store.read(key);
  if (raw === null || raw.trim() === "") return empty;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export async function listSavedReports(store: KeyValueStore): Promise<SavedReport[]> {
  const doc = await readDoc<SavedReportsDoc>(store, SAVED_REPORTS_KEY, savedDocSchema, { version: 1, reports: [] });
  return doc.reports;
}

export async function upsertSavedReport(
  store: KeyValueStore,
  input: { id?: string; name: string; definition: ReportDefinition },
  actorId: string,
  nowIso: string,
  newId: string,
): Promise<SavedReport> {
  const reports = await listSavedReports(store);
  const existing = input.id !== undefined ? reports.find((r) => r.id === input.id) : undefined;
  const saved: SavedReport = existing !== undefined
    ? { ...existing, name: input.name, definition: input.definition, updatedAt: nowIso }
    : {
        id: newId,
        name: input.name,
        definition: input.definition,
        createdBy: actorId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
  const next = existing !== undefined
    ? reports.map((r) => (r.id === saved.id ? saved : r))
    : [...reports, saved];
  await store.write(SAVED_REPORTS_KEY, JSON.stringify({ version: 1, reports: next }), actorId);
  return saved;
}

export async function deleteSavedReport(store: KeyValueStore, id: string, actorId: string): Promise<boolean> {
  const reports = await listSavedReports(store);
  const next = reports.filter((r) => r.id !== id);
  if (next.length === reports.length) return false;
  await store.write(SAVED_REPORTS_KEY, JSON.stringify({ version: 1, reports: next }), actorId);
  return true;
}

export async function listReportSchedules(store: KeyValueStore): Promise<ReportSchedule[]> {
  const doc = await readDoc<ReportSchedulesDoc>(store, REPORT_SCHEDULES_KEY, schedulesDocSchema, { version: 1, schedules: [] });
  return doc.schedules;
}

export async function upsertReportSchedule(
  store: KeyValueStore,
  schedule: ReportSchedule,
  actorId: string,
): Promise<ReportSchedule> {
  const schedules = await listReportSchedules(store);
  const exists = schedules.some((s) => s.id === schedule.id);
  const next = exists ? schedules.map((s) => (s.id === schedule.id ? schedule : s)) : [...schedules, schedule];
  await store.write(REPORT_SCHEDULES_KEY, JSON.stringify({ version: 1, schedules: next }), actorId);
  return schedule;
}

export async function deleteReportSchedule(store: KeyValueStore, id: string, actorId: string): Promise<boolean> {
  const schedules = await listReportSchedules(store);
  const next = schedules.filter((s) => s.id !== id);
  if (next.length === schedules.length) return false;
  await store.write(REPORT_SCHEDULES_KEY, JSON.stringify({ version: 1, schedules: next }), actorId);
  return true;
}

export async function markScheduleSent(
  store: KeyValueStore,
  id: string,
  sentAtIso: string,
  periodKey: string,
  actorId: string,
): Promise<void> {
  const schedules = await listReportSchedules(store);
  const next = schedules.map((s) => (s.id === id ? { ...s, lastSentAt: sentAtIso, lastPeriodKey: periodKey } : s));
  await store.write(REPORT_SCHEDULES_KEY, JSON.stringify({ version: 1, schedules: next }), actorId);
}
