import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { getCallCenterReport, parseReportRange } from "@/callcenter/reports";

// Call-center reports — C5. RBAC: orders.view (same as the queue route).
// Feature flag: module.call_center (defaults OFF -> 403 FEATURE_LOCKED).
// Range: ?from=YYYY-MM-DD&to=YYYY-MM-DD on the Asia/Dhaka calendar;
// defaults to the last 30 Dhaka days. Metric definitions live in
// src/callcenter/reports.ts and are echoed in the response meta so no
// consumer has to guess what a rate means.
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
  await ensureDbFeatureFlags().catch(() => {});
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();

  const url = new URL(req.url);
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
    return NextResponse.json({
      data: report,
      meta: {
        persistence: "database",
        module: "module.call_center",
        range,
        definitions: {
          contactRate: "logs excluding NO_ANSWER + WRONG_NUMBER, over all logs in range",
          confirmationRate: "PENDING_ORDER tasks created in range, DONE, final outcome CONFIRMED — over the same cohort's DONE tasks",
          rescueRate: "FAILED_DELIVERY tasks, same shape as confirmationRate (outcome-based only)",
          callbackKeptRate: "CALLBACK logs in range whose task has a later CONFIRMED log",
        },
      },
    });
  } catch {
    return dbNotReady();
  }
}
