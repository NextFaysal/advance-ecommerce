import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales, reportToCsv } from "@/reports/service";
import { DEMO_SALES_ROWS } from "@/reports/demo";
import { guardError, requireAdmin } from "@/reports/guard";

// GET /api/v1/admin/reports/export?from=&to= — CSV export (stub data source).
// RBAC: reports.export. Audit note: exports are sensitive — a Prisma
// implementation must writeAudit() with a reason and apply export
// restriction + watermark rules (Spec F) before streaming real data.
// CSV money columns are integer poisha (no float formatting).
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to are required." } }, { status: 400 });
  const csv = reportToCsv(aggregateSales(DEMO_SALES_ROWS, parsed.data, false));
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-${parsed.data.from}-to-${parsed.data.to}.csv"` },
  });
}
