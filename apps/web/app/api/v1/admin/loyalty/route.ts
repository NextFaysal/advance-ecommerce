import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  DEFAULT_LOYALTY_CONFIG,
  adjustPointsSchema,
  availableBalance,
  buildAdjustEntry,
  demoAffiliates,
  demoCommissionEntries,
  demoLoyaltyFlag,
  demoMembers,
  demoReferrals,
  lifetimeEarnedPoints,
  loyaltyLedgerStore,
  summarizeAffiliatePayout,
  tierForLifetimePoints,
} from "@/loyalty/index";

// Loyalty + Referral + Affiliate — Agent 36, Step 27 gap.
// RBAC: marketing.coupon. Persistence: in-memory demo store (labelled).
// The ledger is append-only: POST appends an ADJUST entry, never edits one.
export async function GET() {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const nowIso = new Date().toISOString();
  const members = demoMembers.map((m) => {
    const entries = loyaltyLedgerStore.filter((e) => e.customerId === m.customerId);
    const lifetime = lifetimeEarnedPoints(entries);
    return {
      customerId: m.customerId,
      name: m.name,
      balance: availableBalance(entries, nowIso),
      lifetimeEarned: lifetime,
      tier: tierForLifetimePoints(lifetime).id,
    };
  });
  const affiliateSummaries = demoAffiliates.map((a) => summarizeAffiliatePayout(demoCommissionEntries, a.id));
  return NextResponse.json({
    data: { config: DEFAULT_LOYALTY_CONFIG, flag: demoLoyaltyFlag, members, referrals: demoReferrals, affiliates: demoAffiliates, affiliateSummaries },
    meta: { persistence: "in-memory-demo", source: "TEMPORARY_DEMO" },
  });
}

// POST = points adjustment outline. Reason is required (schema) and the
// resulting balance can never go negative (buildAdjustEntry enforces it).
export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = adjustPointsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid adjustment. A non-zero points value and a reason are required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const nowIso = new Date().toISOString();
  const entries = loyaltyLedgerStore.filter((e) => e.customerId === parsed.data.customerId);
  const result = buildAdjustEntry({
    id: `pts_adj_${Date.now()}`,
    customerId: parsed.data.customerId,
    points: parsed.data.points,
    reason: parsed.data.reason,
    entries,
    nowIso,
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 422 });
  }
  loyaltyLedgerStore.push(result.entry);
  const balance = availableBalance([...entries, result.entry], nowIso);
  return NextResponse.json(
    { data: { entry: result.entry, balance }, meta: { persistence: "in-memory-demo" } },
    { status: 201 },
  );
}
