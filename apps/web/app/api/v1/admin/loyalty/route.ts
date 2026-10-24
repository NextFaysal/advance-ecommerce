import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  DEFAULT_LOYALTY_CONFIG,
  adjustPointsSchema,
  availableBalance,
  buildAdjustEntry,
  demoLoyaltyFlag,
  lifetimeEarnedPoints,
  summarizeAffiliatePayout,
  tierForLifetimePoints,
} from "@/loyalty/index";
import { loyaltyStore } from "@/loyalty/db-store";

// Loyalty + Referral + Affiliate — Agent 36, Step 27 gap.
// RBAC: marketing.coupon. DB-backed (Prisma) since 2026-10-24: members
// are the customers holding ledger rows, balances are DERIVED by
// folding the append-only ledger, and POST appends an ADJUST entry —
// it never edits one. An empty DB returns empty lists, not samples.
export async function GET() {
  const guard = await requireAdmin("marketing.coupon");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const nowIso = new Date().toISOString();
  const memberRows = await loyaltyStore.listMembers();
  const members = await Promise.all(
    memberRows.map(async (m) => {
      const entries = await loyaltyStore.listEntries(m.customerId);
      const lifetime = lifetimeEarnedPoints(entries);
      return {
        customerId: m.customerId,
        name: m.name,
        balance: availableBalance(entries, nowIso),
        lifetimeEarned: lifetime,
        tier: tierForLifetimePoints(lifetime).id,
      };
    }),
  );
  const [referrals, affiliates, commissions] = await Promise.all([
    loyaltyStore.listReferrals(),
    loyaltyStore.listAffiliates(),
    loyaltyStore.listCommissions(),
  ]);
  const affiliateSummaries = affiliates.map((a) => summarizeAffiliatePayout(commissions, a.id));
  return NextResponse.json({
    data: { config: DEFAULT_LOYALTY_CONFIG, flag: demoLoyaltyFlag, members, referrals, affiliates, affiliateSummaries },
    meta: { persistence: "database" },
  });
}

// POST = points adjustment outline. Reason is required (schema) and the
// resulting balance can never go negative (buildAdjustEntry enforces it
// against the DB-derived balance).
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
  const entries = await loyaltyStore.listEntries(parsed.data.customerId);
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
  const saved = await loyaltyStore.appendEntry(result.entry);
  const balance = availableBalance([...entries, saved], nowIso);
  return NextResponse.json(
    { data: { entry: saved, balance }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
