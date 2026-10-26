import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  deleteReportSchedule,
  listReportSchedules,
  prismaKeyValueStore,
  reportScheduleSchema,
  upsertReportSchedule,
} from "@/reports/saved-reports";

// Report delivery schedules (ADV-8) — persisted as one JSON document
// in the Setting table alongside the saved definitions.
// GET: list (reports.view). POST: create/update (reports.export).
// DELETE ?id=: remove (reports.export). Triggering due schedules
// lives at POST .../schedules/run-due.
export async function GET() {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const schedules = await listReportSchedules(prismaKeyValueStore());
  return NextResponse.json({ data: { schedules }, meta: { source: "database" } });
}

const saveBodySchema = reportScheduleSchema.omit({ id: true, createdBy: true, createdAt: true, lastSentAt: true, lastPeriodKey: true }).extend({
  id: z.string().min(1).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = saveBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A valid schedule is required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const store = prismaKeyValueStore();
  const existing = parsed.data.id !== undefined
    ? (await listReportSchedules(store)).find((s) => s.id === parsed.data.id)
    : undefined;
  const schedule = {
    id: existing?.id ?? crypto.randomUUID(),
    reportId: parsed.data.reportId,
    cadence: parsed.data.cadence,
    weekday: parsed.data.weekday,
    time: parsed.data.time,
    recipients: parsed.data.recipients,
    enabled: parsed.data.enabled,
    lastSentAt: existing?.lastSentAt ?? null,
    lastPeriodKey: existing?.lastPeriodKey ?? null,
    createdBy: existing?.createdBy ?? guard.userId,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const saved = await upsertReportSchedule(store, schedule, guard.userId);
  return NextResponse.json({ data: { schedule: saved }, meta: { source: "database" } });
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (id === "") {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "id is required." } }, { status: 400 });
  }
  const removed = await deleteReportSchedule(prismaKeyValueStore(), id, guard.userId);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Schedule not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { deleted: true } });
}
