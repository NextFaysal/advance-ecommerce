/**
 * Prisma-backed loyalty / referral / affiliate store + delivered-order
 * hooks — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): API routes and order-flow
 * callers import this file directly; src/loyalty/store.ts keeps the
 * demo arrays the admin page playground renders.
 *
 * INVARIANTS PRESERVED (verified at build time, kept here):
 *  - The points ledger is APPEND-ONLY and balances are DERIVED by
 *    folding entries (points.ts) — this store never writes a balance.
 *    The schema's balanceAfter column is deliberately left NULL so no
 *    stored number can ever be mistaken for the balance.
 *  - Referral rewards fire ONLY from qualifyReferral()'s verdict
 *    (referee's FIRST order, DELIVERED, referral still PENDING) and the
 *    reward ledger entries use referral-derived ids, so a replay hits
 *    the primary key instead of paying twice.
 *  - Affiliate commission is floored to poisha by the pure builder;
 *    PENDING on delivery, PAYABLE only after the return window, VOID
 *    when the order is returned / refunded / cancelled (refresh pass).
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - Referral.qualifyingOrderId and Referral.rewardedAt have no exact
 *    columns: reward time persists in qualifiedAt; the qualifying
 *    order id does NOT persist (the reward EARN entries carry it as
 *    their orderId, so it is recoverable from the ledger). rewardPoints
 *    stores the TOTAL points granted (referrer + referee) at reward.
 *  - AffiliatePartner.phone is required + unique in the schema but
 *    absent from the TS type: createAffiliate takes it as a separate
 *    argument; reads drop it (the TS shape never had it).
 *  - AffiliateCommission keeps only amountPoisha (= commissionPoisha),
 *    status and payableAt: orderTotalPoisha / commissionBps do NOT
 *    persist (read back 0), and deliveredAt reads back as the row's
 *    createdAt — commissions are recorded at delivery, so they agree.
 *  - PointsLedgerEntry.kind stores the TS type verbatim (EARN /
 *    REDEEM / EXPIRE / ADJUST).
 */
import { prisma } from "@advance-ecommerce/db";
import { getOrderByIdOrNo } from "../orders/repository";
import {
  DEFAULT_LOYALTY_CONFIG,
  type AffiliateCommissionEntry,
  type AffiliatePartner,
  type LoyaltyConfig,
  type PointsLedgerEntry,
  type Referral,
} from "./types";
import { buildEarnEntry } from "./points";
import { qualifyReferral } from "./referral";
import { affiliateCommissionStatus, buildCommissionEntry } from "./affiliate";

type PointsRow = Awaited<ReturnType<typeof prisma.pointsLedgerEntry.findMany>>[number];
type ReferralRow = Awaited<ReturnType<typeof prisma.referral.findMany>>[number];
type PartnerRow = Awaited<ReturnType<typeof prisma.affiliatePartner.findMany>>[number];
type CommissionRow = Awaited<ReturnType<typeof prisma.affiliateCommission.findMany>>[number];

function rowToEntry(row: PointsRow): PointsLedgerEntry {
  return {
    id: row.id,
    customerId: row.customerId,
    type: (["EARN", "REDEEM", "EXPIRE", "ADJUST"].includes(row.kind)
      ? row.kind
      : "ADJUST") as PointsLedgerEntry["type"],
    points: row.points,
    orderId: row.orderId,
    reason: row.reason,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToReferral(row: ReferralRow): Referral {
  return {
    id: row.id,
    referrerCustomerId: row.referrerId,
    refereeCustomerId: row.refereeId,
    code: row.code,
    status: (["PENDING", "QUALIFIED", "REWARDED", "REJECTED"].includes(row.status)
      ? row.status
      : "PENDING") as Referral["status"],
    qualifyingOrderId: null, // not persisted — see header
    createdAt: row.createdAt.toISOString(),
    rewardedAt: row.qualifiedAt?.toISOString() ?? null,
  };
}

function rowToPartner(row: PartnerRow): AffiliatePartner {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    commissionBps: row.commissionBps,
    status: row.status === "SUSPENDED" ? "SUSPENDED" : "ACTIVE",
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToCommission(row: CommissionRow): AffiliateCommissionEntry {
  return {
    id: row.id,
    partnerId: row.partnerId,
    orderId: row.orderId,
    orderTotalPoisha: 0, // not persisted — see header
    commissionBps: 0, // not persisted — see header
    commissionPoisha: row.amountPoisha,
    status: (["PENDING", "PAYABLE", "PAID", "VOID"].includes(row.status)
      ? row.status
      : "PENDING") as AffiliateCommissionEntry["status"],
    deliveredAt: row.createdAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface LoyaltyMember {
  customerId: string;
  name: string;
  phone: string;
}

export class PrismaLoyaltyStore {
  /* ---------------- Points ledger (append-only) ---------------- */

  async listEntries(customerId: string): Promise<PointsLedgerEntry[]> {
    const rows = await prisma.pointsLedgerEntry.findMany({
      where: { customerId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToEntry);
  }

  async appendEntry(entry: PointsLedgerEntry): Promise<PointsLedgerEntry> {
    const row = await prisma.pointsLedgerEntry.create({
      data: {
        ...(entry.id ? { id: entry.id } : {}),
        customerId: entry.customerId,
        kind: entry.type,
        points: entry.points,
        // balanceAfter deliberately NULL: balances are derived, never stored.
        reason: entry.reason,
        orderId: entry.orderId,
        expiresAt: entry.expiresAt ? new Date(entry.expiresAt) : null,
      },
    });
    return rowToEntry(row);
  }

  /** Members = customers holding at least one ledger entry. */
  async listMembers(): Promise<LoyaltyMember[]> {
    const distinct = await prisma.pointsLedgerEntry.findMany({
      distinct: ["customerId"],
      select: { customerId: true },
      orderBy: { customerId: "asc" },
    });
    const ids = distinct.map((d) => d.customerId);
    if (ids.length === 0) return [];
    const customers = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, phone: true },
    });
    const byId = new Map(customers.map((c) => [c.id, c]));
    return ids.map((customerId) => ({
      customerId,
      name: byId.get(customerId)?.name ?? customerId,
      phone: byId.get(customerId)?.phone ?? "",
    }));
  }

  /* ---------------- Referrals ---------------- */

  async listReferrals(): Promise<Referral[]> {
    const rows = await prisma.referral.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(rowToReferral);
  }

  async getReferralByReferee(refereeCustomerId: string): Promise<Referral | undefined> {
    const row = await prisma.referral.findUnique({ where: { refereeId: refereeCustomerId } });
    return row ? rowToReferral(row) : undefined;
  }

  async createReferral(r: Referral): Promise<Referral> {
    const row = await prisma.referral.create({
      data: {
        ...(r.id ? { id: r.id } : {}),
        referrerId: r.referrerCustomerId,
        refereeId: r.refereeCustomerId,
        code: r.code,
        status: r.status,
        rewardPoints: 0,
        qualifiedAt: r.rewardedAt ? new Date(r.rewardedAt) : null,
      },
    });
    return { ...rowToReferral(row), qualifyingOrderId: r.qualifyingOrderId };
  }

  async replaceReferral(r: Referral, rewardPoints: number): Promise<void> {
    await prisma.referral.update({
      where: { id: r.id },
      data: {
        status: r.status,
        rewardPoints,
        qualifiedAt: r.rewardedAt ? new Date(r.rewardedAt) : null,
      },
    });
  }

  /* ---------------- Affiliate ---------------- */

  async listAffiliates(): Promise<AffiliatePartner[]> {
    const rows = await prisma.affiliatePartner.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(rowToPartner);
  }

  async createAffiliate(partner: AffiliatePartner, phone: string): Promise<AffiliatePartner> {
    const row = await prisma.affiliatePartner.create({
      data: {
        ...(partner.id ? { id: partner.id } : {}),
        name: partner.name,
        phone,
        code: partner.code,
        commissionBps: partner.commissionBps,
        status: partner.status,
      },
    });
    return rowToPartner(row);
  }

  async listCommissions(partnerId?: string): Promise<AffiliateCommissionEntry[]> {
    const rows = await prisma.affiliateCommission.findMany({
      where: partnerId ? { partnerId } : {},
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToCommission);
  }

  async appendCommission(
    entry: AffiliateCommissionEntry,
    payableAtIso: string | null,
  ): Promise<AffiliateCommissionEntry> {
    const row = await prisma.affiliateCommission.create({
      data: {
        ...(entry.id ? { id: entry.id } : {}),
        partnerId: entry.partnerId,
        orderId: entry.orderId,
        amountPoisha: entry.commissionPoisha,
        status: entry.status,
        payableAt: payableAtIso ? new Date(payableAtIso) : null,
      },
    });
    // Write echo for the non-persisted fields (see header).
    return { ...rowToCommission(row), orderTotalPoisha: entry.orderTotalPoisha, commissionBps: entry.commissionBps, deliveredAt: entry.deliveredAt };
  }

  async setCommissionStatus(id: string, status: AffiliateCommissionEntry["status"]): Promise<void> {
    await prisma.affiliateCommission.update({ where: { id }, data: { status } });
  }
}

/** Shared Prisma instance used by the loyalty API route. */
export const loyaltyStore = new PrismaLoyaltyStore();

/* ------------------------------------------------------------------ */
/* Delivered-order hooks (the order-paid/delivered funnel calls these; */
/* checkout itself does not consume them yet — same contract status    */
/* as pointsToDiscountPoisha).                                         */
/* ------------------------------------------------------------------ */

/** EARN points for a delivered order. Idempotent per order (entry id is
 *  derived from the order id — a replay returns the existing entry). */
export async function creditLoyaltyForDeliveredOrder(input: {
  customerId: string;
  orderId: string;
  orderTotalPoisha: number;
  nowIso: string;
  config?: LoyaltyConfig;
}): Promise<PointsLedgerEntry | null> {
  const entry = buildEarnEntry({
    id: `pts_earn_${input.orderId}`,
    customerId: input.customerId,
    orderId: input.orderId,
    orderTotalPoisha: input.orderTotalPoisha,
    nowIso: input.nowIso,
    config: input.config,
  });
  if (!entry) return null;
  const existing = await prisma.pointsLedgerEntry.findUnique({ where: { id: entry.id } });
  if (existing) return rowToEntry(existing);
  return loyaltyStore.appendEntry(entry);
}

/** Fire the referral reward for the referee's first DELIVERED order.
 *  Returns null when there is nothing to pay (no referral, not first,
 *  or already rewarded) — the reward can only ever fire once. */
export async function qualifyReferralForDeliveredOrder(input: {
  refereeCustomerId: string;
  orderId: string;
  isRefereeFirstOrder: boolean;
  nowIso: string;
  config?: LoyaltyConfig;
}): Promise<{ referral: Referral; referrerRewardPoints: number; refereeRewardPoints: number } | null> {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  const referral = await loyaltyStore.getReferralByReferee(input.refereeCustomerId);
  if (!referral) return null;
  const result = qualifyReferral({
    referral,
    orderId: input.orderId,
    orderStatus: "DELIVERED",
    isRefereeFirstOrder: input.isRefereeFirstOrder,
    nowIso: input.nowIso,
    config,
  });
  if (!result) return null;
  const expiresAt = new Date(new Date(input.nowIso).getTime() + config.pointsExpiryDays * 86_400_000).toISOString();
  await loyaltyStore.replaceReferral(
    result.referral,
    result.referrerRewardPoints + result.refereeRewardPoints,
  );
  // Reward lots are EARN entries (they join the FIFO fold and expire
  // like earned points). Ids are referral-derived: a replay hits the
  // primary key instead of paying twice.
  await loyaltyStore.appendEntry({
    id: `pts_ref_${referral.id}_referrer`,
    customerId: referral.referrerCustomerId,
    type: "EARN",
    points: result.referrerRewardPoints,
    orderId: input.orderId,
    reason: "Referral reward (referrer)",
    expiresAt,
    createdAt: input.nowIso,
  });
  await loyaltyStore.appendEntry({
    id: `pts_ref_${referral.id}_referee`,
    customerId: referral.refereeCustomerId,
    type: "EARN",
    points: result.refereeRewardPoints,
    orderId: input.orderId,
    reason: "Referral reward (referee)",
    expiresAt,
    createdAt: input.nowIso,
  });
  return result;
}

/** Record the (PENDING) affiliate commission for a delivered order. */
export async function recordAffiliateCommissionForDelivery(input: {
  partnerId: string;
  orderId: string;
  orderTotalPoisha: number;
  commissionBps: number;
  deliveredAt: string;
  nowIso: string;
  config?: LoyaltyConfig;
}): Promise<AffiliateCommissionEntry> {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  const entry = buildCommissionEntry({
    id: `com_${input.orderId}_${input.partnerId}`,
    partnerId: input.partnerId,
    orderId: input.orderId,
    orderTotalPoisha: input.orderTotalPoisha,
    commissionBps: input.commissionBps,
    orderStatus: "DELIVERED",
    deliveredAt: input.deliveredAt,
    nowIso: input.nowIso,
    config,
  });
  const payableAt = new Date(
    new Date(input.deliveredAt).getTime() + config.affiliateReturnWindowDays * 86_400_000,
  ).toISOString();
  return loyaltyStore.appendCommission(entry, payableAt);
}

/** Re-evaluate PENDING / PAYABLE commissions against live order state:
 *  VOID when the order was returned / refunded / cancelled, PAYABLE
 *  once the return window has passed with the order still DELIVERED.
 *  PAID rows are never touched. Order state is read through the orders
 *  repository (read-only). Returns how many rows changed. */
export async function refreshAffiliateCommissionStatuses(input: {
  nowIso: string;
  config?: LoyaltyConfig;
}): Promise<{ updated: number }> {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  const rows = await prisma.affiliateCommission.findMany({
    where: { status: { in: ["PENDING", "PAYABLE"] } },
  });
  let updated = 0;
  for (const row of rows) {
    const order = await getOrderByIdOrNo(row.orderId);
    if (!order) continue; // cannot judge — leave as recorded
    const target = affiliateCommissionStatus({
      orderStatus: order.status,
      deliveredAt: row.createdAt.toISOString(),
      nowIso: input.nowIso,
      config,
    });
    if (target !== row.status) {
      await loyaltyStore.setCommissionStatus(row.id, target);
      updated += 1;
    }
  }
  return { updated };
}
