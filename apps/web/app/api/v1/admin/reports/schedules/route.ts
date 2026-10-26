import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listScheduleViews, parseScheduleInputs, replaceSchedules } from "@/reports/schedules";
import { writeAudit } from "@/lib/audit";

// Scheduled report delivery — top-level admin API (ADV-8, wave 52).
// The schedules themselves are the SAME `reports.schedules` Setting
// document the builder routes (…/reports/builder/schedules) manage
// per item; this surface exists for whole-list management from the
// main reports page panel:
//   GET — list schedules as views (reports.view), with the linked
//         saved reports' names resolved.
//   PUT — replace the whole list (reports.export). Following the
//         reports module's export convention (builder/export, pdf),
//         a non-empty `reason` is MANDATORY and the write is
//         recorded in the AuditLog. Server-owned fields
//         (lastSentAt/lastPeriodKey/createdBy/createdAt) survive a
//         replace — see src/reports/schedules.ts.
// Delivery itself is unchanged: due schedules enqueue report_delivery
// email jobs (admin run-due route today; the worker tick via
// processDueReportSchedules on the VPS host) and the worker attaches
// the rebuilt CSV at send time. Format is CSV only.
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const schedules = await listScheduleViews();
  return NextResponse.json({
    data: { schedules },
    meta: { source: "database", format: "csv" },
  });
}

export async function PUT(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = (await req.json().catch(() => ({}))) as { schedules?: unknown; reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty reason is required." } },
      { status: 400 },
    );
  }
  const parsed = parseScheduleInputs(body.schedules);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: parsed.message } },
      { status: 400 },
    );
  }
  const schedules = await replaceSchedules(parsed.inputs, guard.userId);
  await writeAudit({
    actorId: guard.userId,
    action: "reports.schedules.update",
    entityType: "report_schedule",
    afterJson: {
      count: schedules.length,
      schedules: schedules.map((s) => ({
        id: s.id,
        reportId: s.reportId,
        cadence: s.cadence,
        weekday: s.weekday,
        time: s.time,
        recipients: s.recipients,
        enabled: s.enabled,
      })),
    },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { schedules }, meta: { source: "database" } });
}
