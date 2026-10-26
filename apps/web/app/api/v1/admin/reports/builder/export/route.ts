import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  buildExportWatermark,
  buildReport,
  builtReportToCsv,
  describeDefinition,
  validateReportDefinition,
} from "@/reports/builder";
import { fetchSalesRows } from "@/reports/db-rows";
import { writeAudit } from "@/lib/audit";

// POST /api/v1/admin/reports/builder/export — watermarked CSV export
// of a custom report (ADV-8). SAME contract as the sales export
// (app/api/v1/admin/reports/export/route.ts): a reason is MANDATORY
// (missing/blank -> 400), the CSV carries the watermark header
// (exported-by / exported-at Asia/Dhaka / reason / range / definition
// / row count), and the export is recorded in the AuditLog.
// RBAC: reports.export.
export async function POST(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = (await req.json().catch(() => ({}))) as { definition?: unknown; reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required." } },
      { status: 400 },
    );
  }
  const validated = validateReportDefinition(body.definition);
  if (!validated.ok) {
    return NextResponse.json({ error: { code: "INVALID_DEFINITION", message: validated.message } }, { status: 400 });
  }
  const definition = validated.definition;
  const rows = await fetchSalesRows(definition.range);
  const built = buildReport(definition, rows);
  await writeAudit({
    actorId: guard.userId,
    action: "reports.builder.export",
    entityType: "report",
    afterJson: { dataset: definition.dataset, rows: built.rows.length, range: definition.range },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const watermark = buildExportWatermark({
    title: "CUSTOM REPORT EXPORT",
    exportedBy: guard.userId,
    exportedAt: new Date(),
    reason,
    range: definition.range,
    rowCount: built.rows.length,
    definitionSummary: describeDefinition(definition),
  });
  const csv = builtReportToCsv(built, watermark);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="custom-report-${definition.dataset}-${definition.range.from}-to-${definition.range.to}.csv"`,
    },
  });
}
