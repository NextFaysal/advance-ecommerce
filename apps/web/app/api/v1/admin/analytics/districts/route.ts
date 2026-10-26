import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { ANALYTICS_FEATURE_FLAG } from "@/ai/types";
import { dateRangeSchema } from "@/reports/types";
import { fetchSalesRows } from "@/reports/db-rows";
import { buildDistrictHeatmap } from "@/analytics/district-heatmap";

// GET /api/v1/admin/analytics/districts?from=YYYY-MM-DD&to=YYYY-MM-DD
// District order heatmap data (ADV-8, doc 22): orders + net revenue per
// district over real order rows, with each district's share (bps) and a
// relative intensity (0..1 vs the busiest district) for the heat visual
// on /admin/analytics. Cancelled orders excluded (reports convention).
// RBAC: reports.view. Flag: module.advanced_analytics (same as the
// analytics bundle route).
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flag = await requireFeature(ANALYTICS_FEATURE_FLAG);
  if (!flag.enabled) return NextResponse.json({ error: { code: flag.code, message: flag.message } }, { status: flag.status });
  const url = new URL(req.url);
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to (YYYY-MM-DD) are required, from <= to." } }, { status: 400 });
  }
  const rows = await fetchSalesRows(parsed.data);
  const districts = buildDistrictHeatmap(rows);
  return NextResponse.json({
    data: { districts },
    meta: { source: "database", range: parsed.data },
  });
}
