import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { buildCsv, getCallCenterReport, parseReportRange, type CallCenterReport } from "@/callcenter/reports";
import { recordDemoAudit } from "../../../audit-log/store";

// Call-center report export — C5. Mirrors the audit-log export pattern:
// a reason is MANDATORY, the CSV carries a watermark header (exported-by,
// exported-at Asia/Dhaka, reason, range), and the export itself is
// recorded in the AuditLog (action "call_center.reports.export").
// CSV content = the summary metrics + the per-agent table. No phone
// numbers exist anywhere in the report, so nothing needs masking here.
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Call center module is locked for this install (module.call_center is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Call-center database is not available." } },
    { status: 503 },
  );
}

export async function GET(req: Request) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();

  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "A non-empty export reason is required." } },
      { status: 400 },
    );
  }
  const range = parseReportRange(
    url.searchParams.get("from") ?? undefined,
    url.searchParams.get("to") ?? undefined,
  );
  if (!range) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "from/to must be YYYY-MM-DD Dhaka dates, from <= to, spanning at most 366 days." } },
      { status: 400 },
    );
  }

  try {
    const report = await getCallCenterReport(range);
    const now = new Date();
    const csv = buildCsv(report, { exportedBy: guard.userId, reason, now });

    const auditEntry = await recordDemoAudit({
      actorId: guard.userId,
      action: "call_center.reports.export",
      entityType: "CallCenterReport",
      entityId: null,
      afterJson: { from: range.from, to: range.to, agentRows: report.agents.length },
      reason,
      ip: req.headers.get("x-forwarded-for"),
      userAgent: req.headers.get("user-agent"),
    });

    return NextResponse.json({
      data: {
        filename: `call-center-report-${range.from}-to-${range.to}.csv`,
        contentType: "text/csv",
        csv,
        rowCount: report.agents.length,
        auditEntryId: auditEntry.id,
      },
      meta: {
        persistence: "database",
        module: "module.call_center",
        note: "Export generated from CallTask/CallLogEntry tables and recorded in the AuditLog.",
      },
    });
  } catch {
    return dbNotReady();
  }
}
