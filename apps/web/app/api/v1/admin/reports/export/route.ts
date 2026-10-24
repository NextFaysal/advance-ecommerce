import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales, reportToCsv } from "@/reports/service";
import { fetchSalesRows } from "@/reports/db-rows";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";

// GET /api/v1/admin/reports/export?from=&to= — CSV export of the sales
// report over real DB rows (Prisma). RBAC: reports.export.
// Audit: every export writes an audit row (best-effort, like the other
// admin exports). Export restriction + watermark rules (Spec F) are NOT
// implemented yet — the CSV is the plain report export.
// CSV money columns are integer poisha (no float formatting).
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to are required." } }, { status: 400 });
  const rows = await fetchSalesRows(parsed.data);
  const bundle = aggregateSales(rows, parsed.data, false);
  await writeAudit({
    actorId: guard.userId,
    action: "reports.export",
    entityType: "report",
    afterJson: { from: parsed.data.from, to: parsed.data.to, orders: bundle.totals.orders, revenuePoisha: bundle.totals.revenuePoisha },
    reason: "Admin sales report CSV export",
  });
  const csv = reportToCsv(bundle);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-${parsed.data.from}-to-${parsed.data.to}.csv"` },
  });
}
