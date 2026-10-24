/**
 * Loyalty demo store (Agent 36) — in-memory SAMPLE data for the admin
 * page playground. The RUNTIME store is DB-backed since 2026-10-24:
 * PrismaLoyaltyStore + delivered-order hooks in ./db-store.ts, used by
 * the loyalty API route. The arrays below are unchanged page fixtures.
 *
 * FLAG NOTE (updated 2026-10-24): `module.loyalty` HAS been added to the
 * seed FEATURE_FLAGS catalogue (OFF by default) by the main agent.
 * Migrated to the unified reader by Agent 62: `demoLoyaltyFlag` below
 * now LIVE-reads the ONE unified flag store in src/lib/feature-flags.ts
 * — the same store the feature-flags API PATCHes — instead of a static
 * page-local value, so a toggle in Admin > Settings > Feature Flags is
 * reflected here in the same process. When the DB-backed source
 * replaces the demo source inside src/lib/feature-flags.ts, this needs
 * no change.
 *
 * Sample members use fictional data; phones are stored normalized and
 * are only ever rendered masked (Phone component / masked views).
 */
import { isFeatureEnabled } from "../lib/feature-flags";
import type { AffiliateCommissionEntry, AffiliatePartner, PointsLedgerEntry, Referral } from "./types";

export const LOYALTY_FLAG_KEY = "module.loyalty";

/**
 * Flag descriptor for the loyalty page/API. `enabled` is a LIVE read of
 * the unified store (not a page-local constant); shape unchanged
 * (key / seededInDb / enabled / note).
 */
export const demoLoyaltyFlag = {
  key: LOYALTY_FLAG_KEY,
  seededInDb: true,
  get enabled(): boolean {
    return isFeatureEnabled(LOYALTY_FLAG_KEY);
  },
  note: "module.loyalty is in the seed FEATURE_FLAGS (OFF by default) — this descriptor live-reads the unified demo flag store in src/lib/feature-flags.ts, the stand-in for the DB flag reader until Prisma wiring lands.",
};

export interface LoyaltyMemberSample {
  customerId: string;
  name: string;
  phone: string;
  entries: PointsLedgerEntry[];
}

// SAMPLE ledger entries (fictional customers, demo only).
export const demoMemberEntries: PointsLedgerEntry[] = [
  { id: "pts_s1", customerId: "cus_sample_1", type: "EARN", points: 850, orderId: "ord_sample_1", reason: null, expiresAt: "2027-10-20T00:00:00.000Z", createdAt: "2026-10-20T10:00:00.000Z" },
  { id: "pts_s2", customerId: "cus_sample_1", type: "REDEEM", points: -200, orderId: "ord_sample_2", reason: null, expiresAt: null, createdAt: "2026-10-22T10:00:00.000Z" },
  { id: "pts_s3", customerId: "cus_sample_2", type: "EARN", points: 2400, orderId: "ord_sample_3", reason: null, expiresAt: "2027-09-15T00:00:00.000Z", createdAt: "2026-09-15T10:00:00.000Z" },
  { id: "pts_s4", customerId: "cus_sample_3", type: "EARN", points: 120, orderId: "ord_sample_4", reason: null, expiresAt: "2027-10-01T00:00:00.000Z", createdAt: "2026-10-01T10:00:00.000Z" },
  { id: "pts_s5", customerId: "cus_sample_3", type: "ADJUST", points: 30, orderId: null, reason: "SAMPLE goodwill adjustment", expiresAt: null, createdAt: "2026-10-05T10:00:00.000Z" },
];

/** Mutable in-memory copy the API appends adjustments to (demo only). */
export const loyaltyLedgerStore: PointsLedgerEntry[] = [...demoMemberEntries];

export const demoMembers: Array<{ customerId: string; name: string; phone: string }> = [
  { customerId: "cus_sample_1", name: "SAMPLE — আয়েশা রহমান", phone: "+8801712345678" },
  { customerId: "cus_sample_2", name: "SAMPLE — তানভীর হোসেন", phone: "+8801812345678" },
  { customerId: "cus_sample_3", name: "SAMPLE — মেহজাবিন চৌধুরী", phone: "+8801912345678" },
];

export const demoReferrals: Referral[] = [
  {
    id: "ref_sample_1",
    referrerCustomerId: "cus_sample_1",
    refereeCustomerId: "cus_sample_3",
    code: "REF-SAMPLE-01",
    status: "REWARDED",
    qualifyingOrderId: "ord_sample_4",
    createdAt: "2026-09-28T10:00:00.000Z",
    rewardedAt: "2026-10-01T10:00:00.000Z",
  },
  {
    id: "ref_sample_2",
    referrerCustomerId: "cus_sample_2",
    refereeCustomerId: "cus_sample_9",
    code: "REF-SAMPLE-02",
    status: "PENDING",
    qualifyingOrderId: null,
    createdAt: "2026-10-20T10:00:00.000Z",
    rewardedAt: null,
  },
];

export const demoAffiliates: AffiliatePartner[] = [
  { id: "aff_sample_1", name: "SAMPLE — Dhaka Deals Page", code: "AFF-SAMPLE1", commissionBps: 500, status: "ACTIVE", createdAt: "2026-08-01T00:00:00.000Z" },
  { id: "aff_sample_2", name: "SAMPLE — Fashion Blog BD", code: "AFF-SAMPLE2", commissionBps: 700, status: "ACTIVE", createdAt: "2026-08-15T00:00:00.000Z" },
];

export const demoCommissionEntries: AffiliateCommissionEntry[] = [
  { id: "com_sample_1", partnerId: "aff_sample_1", orderId: "ord_sample_3", orderTotalPoisha: 240000, commissionBps: 500, commissionPoisha: 12000, status: "PAYABLE", deliveredAt: "2026-09-20T00:00:00.000Z", createdAt: "2026-09-20T00:00:00.000Z" },
  { id: "com_sample_2", partnerId: "aff_sample_1", orderId: "ord_sample_5", orderTotalPoisha: 85000, commissionBps: 500, commissionPoisha: 4250, status: "PENDING", deliveredAt: "2026-10-23T00:00:00.000Z", createdAt: "2026-10-23T00:00:00.000Z" },
  { id: "com_sample_3", partnerId: "aff_sample_2", orderId: "ord_sample_6", orderTotalPoisha: 150000, commissionBps: 700, commissionPoisha: 10500, status: "PAID", deliveredAt: "2026-08-20T00:00:00.000Z", createdAt: "2026-08-20T00:00:00.000Z" },
];
