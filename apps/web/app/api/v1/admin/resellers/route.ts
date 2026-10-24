import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { buildDashboardsDb, listWithdrawals, requestWithdrawalDb } from "@/reseller/store";
import { withdrawalRequestSchema } from "@/reseller/types";

// Resellers — Agent 14, Step 46 (A5). RBAC: resellers.view (list) /
// resellers.manage (withdrawal creation). The shared guard accepts one
// permission, so reports.view is not kept as a legacy alias.
// Feature flag: module.reseller (defaults OFF -> 403 FEATURE_LOCKED).
// Persistence: Prisma DB via src/reseller/store.ts (the pure wallet
// rules in src/reseller/wallet.ts still decide every money action,
// including the G1 status guards).
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller module is locked for this install (module.reseller is OFF)." } },
    { status: 403 },
  );
}

function dbNotReady() {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Reseller database is not available." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("resellers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  try {
    const [dashboards, withdrawals] = await Promise.all([buildDashboardsDb(), listWithdrawals()]);
    return NextResponse.json({
      data: { dashboards, withdrawals },
      meta: { persistence: "database", module: "module.reseller" },
    });
  } catch {
    return dbNotReady();
  }
}

/** POST a withdrawal request for a reseller (admin-assisted / reseller-panel proxy in this slice). */
export async function POST(req: Request) {
  const guard = await requireAdmin("resellers.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  const body = (await req.json().catch(() => ({}))) as { resellerId?: string };
  const parsed = withdrawalRequestSchema.safeParse(body);
  if (!parsed.success || typeof body.resellerId !== "string") {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "resellerId + valid withdrawal fields required.", details: parsed.success ? [] : parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await requestWithdrawalDb({
      resellerId: body.resellerId,
      amountPoisha: parsed.data.amountPoisha,
      method: parsed.data.method,
      accountRefMasked: parsed.data.accountRefMasked,
    });
    if (!result.ok) {
      return NextResponse.json({ error: { code: "WITHDRAWAL_REJECTED", message: result.error } }, { status: 422 });
    }
    return NextResponse.json(
      { data: { withdrawal: result.request }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch {
    return dbNotReady();
  }
}
