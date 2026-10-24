import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoResellerFlags, isResellerEnabled } from "@/reseller/flags";
import { demoDashboards, demoWalletEntries, findDemoReseller } from "@/reseller/service";
import { withdrawalRequestSchema } from "@/reseller/types";
import { requestWithdrawal } from "@/reseller/wallet";
import { demoWithdrawals } from "@/reseller/service";

// Resellers — Agent 14, Step 46 (A5). RBAC: resellers.view (list) /
// resellers.manage (withdrawal creation). The shared guard accepts one
// permission, so reports.view is not kept as a legacy alias.
// Feature flag: module.reseller (demo store, defaults OFF -> 403 FEATURE_LOCKED).
// Persistence: in-memory demo (see src/reseller/service.ts).
function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller module is locked for this install (module.reseller is OFF)." } },
    { status: 403 },
  );
}

export async function GET() {
  const guard = await requireAdmin("resellers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  if (!isResellerEnabled(demoResellerFlags)) return locked();
  return NextResponse.json({
    data: { dashboards: demoDashboards(), withdrawals: demoWithdrawals },
    meta: { persistence: "in-memory-demo", module: "module.reseller" },
  });
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
  const now = new Date().toISOString();
  const suffix = `${Date.now()}`;
  const result = requestWithdrawal(
    demoWalletEntries.filter((e) => e.resellerId === body.resellerId),
    demoWithdrawals,
    {
      id: `wd-${suffix}`,
      holdEntryId: `wlt-${suffix}-hold`,
      resellerId: body.resellerId,
      reseller: findDemoReseller(body.resellerId),
      amountPoisha: parsed.data.amountPoisha,
      method: parsed.data.method,
      accountRefMasked: parsed.data.accountRefMasked,
      createdAt: now,
    },
  );
  if (!result.ok) {
    return NextResponse.json({ error: { code: "WITHDRAWAL_REJECTED", message: result.error } }, { status: 422 });
  }
  demoWithdrawals.push(result.request);
  demoWalletEntries.push(result.holdEntry);
  return NextResponse.json(
    { data: { withdrawal: result.request }, meta: { persistence: "in-memory-demo" } },
    { status: 201 },
  );
}
