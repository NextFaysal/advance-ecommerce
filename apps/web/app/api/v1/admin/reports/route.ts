import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales } from "@/reports/service";
import { DEMO_SALES_ROWS } from "@/reports/demo";
import { guardError, requireAdmin } from "@/reports/guard";

// GET /api/v1/admin/reports/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&compare=1
// RBAC: reports.view. P&L uses stored costPoisha (field-level permission for
// cost detail is reports.accounting — totals here are aggregates, not per-
// product cost rows). Data source is TEMPORARY_DEMO until order DB queries land.
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to (YYYY-MM-DD) are required, from <= to." } }, { status: 400 });
  const bundle = aggregateSales(DEMO_SALES_ROWS, parsed.data, url.searchParams.get("compare") === "1");
  return NextResponse.json({ data: bundle, meta: { persistence: "demo-rows", source: "TEMPORARY_DEMO" } });
}
