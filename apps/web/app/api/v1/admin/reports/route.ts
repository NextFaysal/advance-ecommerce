import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales } from "@/reports/service";
import { fetchSalesRows, withComparisonWindow } from "@/reports/db-rows";
import { guardError, requireAdmin } from "@/reports/guard";

// GET /api/v1/admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=1
// RBAC: reports.view. P&L uses stored costPoisha (field-level permission for
// cost detail is reports.accounting — totals here are aggregates, not per-
// product cost rows). Data source is the real orders DB (Prisma): rows are
// built per order item from stored poisha fields; date range is read on
// the Asia/Dhaka calendar. Variants without a recorded costPoisha count
// as cost 0 (unknown cost is never invented).
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to (YYYY-MM-DD) are required, from <= to." } }, { status: 400 });
  const compare = url.searchParams.get("compare") === "1";
  const rows = await fetchSalesRows(compare ? withComparisonWindow(parsed.data) : parsed.data);
  const bundle = aggregateSales(rows, parsed.data, compare);
  return NextResponse.json({ data: bundle, meta: { persistence: "database", source: "prisma", timezone: "Asia/Dhaka" } });
}
