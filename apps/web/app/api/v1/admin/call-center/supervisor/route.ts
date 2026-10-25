import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { loadSupervisorBoard } from "@/callcenter/supervisor-store";

// Call-center SUPERVISOR board — C2. Whole-board aggregates (counts by
// status/source, oldest queued age, per-agent load, due callbacks, SLA
// breaches) from src/callcenter/supervisor-store.ts.
// RBAC: staff.manage — the manage-level permission this module itself
// uses to define a supervisor (the outcome route's G3 override checks
// the same key). Regular agents keep using the agent queue routes
// (orders.view / orders.update_status); there is no call-center-specific
// permission key in the RBAC catalogue.
// Feature flag: module.call_center (defaults OFF -> 403 FEATURE_LOCKED),
// identical to the sibling call-center routes.
// Phones: the board payload carries MASKED numbers only, by design.
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

export async function GET() {
  const guard = await requireAdmin("staff.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) return locked();
  try {
    const board = await loadSupervisorBoard();
    return NextResponse.json({
      data: board,
      meta: { persistence: "database", module: "module.call_center" },
    });
  } catch {
    return dbNotReady();
  }
}
