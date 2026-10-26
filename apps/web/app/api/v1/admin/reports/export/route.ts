import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales, reportToCsv } from "@/reports/service";
import { fetchSalesRows } from "@/reports/db-rows";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";

// GET /api/v1/admin/reports/export?from=&to=&reason= — Watermarked CSV export
// of the sales report over real DB rows (Prisma). RBAC: reports.export.
// Audit: Every export strictly requires a reason, carries a cryptographic/metadata
// watermark header, and logs an audit trail row (Spec F compliant).
// CSV money columns are integer poisha (no float formatting).
export async function GET(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required for security auditing." } },
      { status: 400 },
    );
  }

  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_RANGE", message: "from/to are required in YYYY-MM-DD format." } },
      { status: 400 },
    );
  }

  const rows = await fetchSalesRows(parsed.data);
  const bundle = aggregateSales(rows, parsed.data, false);
  const exportedAt = new Date().toISOString();

  await writeAudit({
    actorId: guard.userId,
    action: "reports.export",
    entityType: "report",
    afterJson: {
      from: parsed.data.from,
      to: parsed.data.to,
      orders: bundle.totals.orders,
      revenuePoisha: bundle.totals.revenuePoisha,
      exportedAt,
    },
    reason,
  });

  const rawCsv = reportToCsv(bundle);

  // Watermark Header (Spec F)
  const watermark = [
    `# ------------------------------------------------------------------`,
    `# CONFIDENTIAL — ADVANCE ECOMMERCE AUDITED EXPORT`,
    `# Exported By: ${guard.userId}`,
    `# Exported At: ${exportedAt}`,
    `# Audit Reason: ${reason.replace(/[\r\n]/g, " ")}`,
    `# Range: ${parsed.data.from} to ${parsed.data.to}`,
    `# ------------------------------------------------------------------`,
    ``,
  ].join("\n");

  const finalCsv = watermark + rawCsv;

  return new NextResponse(finalCsv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sales-${parsed.data.from}-to-${parsed.data.to}.csv"`,
      "X-Export-Watermarked": "true",
    },
  });
}
