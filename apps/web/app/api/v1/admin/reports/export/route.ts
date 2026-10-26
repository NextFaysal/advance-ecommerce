import { NextResponse } from "next/server";
import { dateRangeSchema } from "@/reports/types";
import { aggregateSales, reportToCsv } from "@/reports/service";
import { fetchSalesRows } from "@/reports/db-rows";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";

// GET /api/v1/admin/reports/export?from=&to=&reason= — CSV export of
// the sales report over real DB rows (Prisma). RBAC: reports.export.
// Spec F watermark (W0-E, doc 21 G3-16) — mirrors the audit-log export
// pattern (app/api/v1/admin/audit-log/export) exactly, in the GET form
// the call-center report export uses: a reason is MANDATORY (missing or
// blank -> 400), the CSV carries a watermark header (exported-by,
// exported-at Asia/Dhaka, reason, range, order count), and the export
// itself is recorded in the AuditLog (action "reports.export") with
// the caller's reason. CSV money columns are integer poisha (no float
// formatting).

function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export async function GET(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required." } },
      { status: 400 },
    );
  }
  const parsed = dateRangeSchema.safeParse({ from: url.searchParams.get("from"), to: url.searchParams.get("to") });
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_RANGE", message: "from/to are required." } }, { status: 400 });
  const rows = await fetchSalesRows(parsed.data);
  const bundle = aggregateSales(rows, parsed.data, false);
  await writeAudit({
    actorId: guard.userId,
    action: "reports.export",
    entityType: "report",
    afterJson: { from: parsed.data.from, to: parsed.data.to, orders: bundle.totals.orders, revenuePoisha: bundle.totals.revenuePoisha },
    reason,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const now = new Date();
  const watermark = [
    "# SALES REPORT EXPORT — Advance Ecommerce (sales report, Order table records)",
    `# exported-by: ${guard.userId}`,
    `# exported-at: ${dhakaTimestamp(now)} (Asia/Dhaka)`,
    `# reason: ${reason.replace(/\n/g, " ")}`,
    `# range: ${parsed.data.from}..${parsed.data.to} (Asia/Dhaka days)`,
    `# orders: ${bundle.totals.orders}`,
    "",
  ].join("\n");
  const csv = watermark + "\n" + reportToCsv(bundle);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="sales-${parsed.data.from}-to-${parsed.data.to}.csv"` },
  });
}
