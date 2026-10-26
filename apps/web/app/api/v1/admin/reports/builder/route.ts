import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { buildReport, validateReportDefinition } from "@/reports/builder";
import { fetchSalesRows } from "@/reports/db-rows";

// POST /api/v1/admin/reports/builder — custom report PREVIEW (ADV-8).
// Body: a report definition { dataset, columns, filters, range }.
// Returns the built rows (preview capped at 200; totalRows carries the
// full count — the export route never caps). RBAC: reports.view.
const PREVIEW_CAP = 200;

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body: unknown = await req.json().catch(() => ({}));
  const validated = validateReportDefinition((body as { definition?: unknown })?.definition ?? body);
  if (!validated.ok) {
    return NextResponse.json({ error: { code: "INVALID_DEFINITION", message: validated.message } }, { status: 400 });
  }
  const rows = await fetchSalesRows(validated.definition.range);
  const built = buildReport(validated.definition, rows);
  return NextResponse.json({
    data: {
      columns: built.columns,
      rows: built.rows.slice(0, PREVIEW_CAP),
      totalRows: built.rows.length,
      previewCapped: built.rows.length > PREVIEW_CAP,
    },
    meta: { source: "database", dataset: built.dataset },
  });
}
