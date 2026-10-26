import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  REPORT_COLUMNS,
  buildReport,
  describeDefinition,
  validateReportDefinition,
  type ReportDataset,
} from "@/reports/builder";
import { fetchSalesRows } from "@/reports/db-rows";
import { dateRangeSchema } from "@/reports/types";
import { writeAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { renderReportPdf } from "@/pdf/report";

// POST /api/v1/admin/reports/pdf — PDF export of a custom report
// (ADV-29, doc 22), beside the builder's CSV export and under the
// SAME contract (app/api/v1/admin/reports/builder/export): a reason
// is MANDATORY (missing/blank -> 400), the document carries the
// export watermark (store admin + generated-at + exported-by +
// reason), and the export is recorded in the AuditLog. RBAC:
// reports.export. Body: { dataset, range: { from, to }, reason,
// columns?, filters? } — columns default to the dataset's full
// catalogue. The PDF shows the first 200 rows; its totals row sums
// ALL rows, exactly the rows the CSV would carry.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = (await req.json().catch(() => ({}))) as {
    dataset?: unknown;
    range?: unknown;
    reason?: unknown;
    columns?: unknown;
    filters?: unknown;
  };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required." } },
      { status: 400 },
    );
  }
  const rangeParsed = dateRangeSchema.safeParse(body.range);
  if (!rangeParsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_RANGE", message: "range.from / range.to are required (YYYY-MM-DD)." } },
      { status: 400 },
    );
  }
  const dataset = body.dataset as ReportDataset;
  const columns =
    Array.isArray(body.columns) && body.columns.length > 0
      ? (body.columns as string[])
      : (REPORT_COLUMNS[dataset]?.map((c) => c.key) ?? []);
  const validated = validateReportDefinition({
    dataset: body.dataset,
    columns,
    filters: body.filters ?? {},
    range: rangeParsed.data,
  });
  if (!validated.ok) {
    return NextResponse.json({ error: { code: "INVALID_DEFINITION", message: validated.message } }, { status: 400 });
  }
  const definition = validated.definition;
  const rows = await fetchSalesRows(definition.range);
  const built = buildReport(definition, rows);
  await writeAudit({
    actorId: guard.userId,
    action: "reports.builder.pdf",
    entityType: "report",
    afterJson: {
      dataset: definition.dataset,
      rows: built.rows.length,
      range: definition.range,
      definition: describeDefinition(definition),
    },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const storeName = (await getSetting("general.store_name")) ?? "";
  const pdf = await renderReportPdf(built, {
    storeName,
    exportedBy: guard.userId,
    reason,
    generatedAt: new Date(),
    rangeLabel: `${definition.range.from} .. ${definition.range.to}`,
  });
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="custom-report-${definition.dataset}-${definition.range.from}-to-${definition.range.to}.pdf"`,
    },
  });
}
