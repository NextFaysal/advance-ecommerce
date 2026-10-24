/**
 * Loyalty + Referral + Affiliate — types & config (Agent 36, Step 27 gap).
 *
 * Money is ALWAYS integer poisha. Percentages are basis points (bps).
 * Points are integers. The points ledger is APPEND-ONLY: a balance is
 * never stored or edited — it is always derived by folding the entries.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Program configuration
// ---------------------------------------------------------------------------

export interface LoyaltyConfig {
  /** Points earned per full 100 poisha (৳1) spent on a delivered order. */
  earnPointsPer100Poisha: number;
  /** Redemption value of 1 point, in poisha (payload edge of checkout). */
  redeemPoishaPerPoint: number;
  /** Max share of the order subtotal payable with points (bps). */
  maxRedeemBpsOfSubtotal: number;
  /** Earned points expire this many days after they are earned. */
  pointsExpiryDays: number;
  /** Referral rewards (points), paid when the referee's FIRST order is delivered. */
  referrerRewardPoints: number;
  refereeRewardPoints: number;
  /** Affiliate default commission on attributed delivered orders (bps). */
  affiliateDefaultCommissionBps: number;
  /** Affiliate attribution cookie window (days) — type-level contract only. */
  affiliateCookieWindowDays: number;
  /** Days after delivery before affiliate commission becomes payable
   *  (fraud guard: covers the return window). */
  affiliateReturnWindowDays: number;
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  earnPointsPer100Poisha: 1,
  redeemPoishaPerPoint: 50,
  maxRedeemBpsOfSubtotal: 2000, // 20%
  pointsExpiryDays: 365,
  referrerRewardPoints: 100,
  refereeRewardPoints: 50,
  affiliateDefaultCommissionBps: 500, // 5%
  affiliateCookieWindowDays: 30,
  affiliateReturnWindowDays: 7,
};

// ---------------------------------------------------------------------------
// Points ledger (append-only)
// ---------------------------------------------------------------------------

export type PointsEntryType = "EARN" | "REDEEM" | "EXPIRE" | "ADJUST";

export interface PointsLedgerEntry {
  id: string;
  customerId: string;
  type: PointsEntryType;
  /** Signed point delta: EARN/ADJUST+ positive, REDEEM/EXPIRE/ADJUST- negative. */
  points: number;
  /** Source order for EARN/REDEEM entries; null for EXPIRE/ADJUST. */
  orderId: string | null;
  /** Required for ADJUST and EXPIRE entries; optional audit note otherwise. */
  reason: string | null;
  /** For EARN entries: when those points expire (ISO). Null otherwise. */
  expiresAt: string | null;
  createdAt: string;
}

export type LoyaltyTierId = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

export interface LoyaltyTier {
  id: LoyaltyTierId;
  labelBn: string;
  labelEn: string;
  /** Lifetime earned points required to reach the tier. */
  minLifetimePoints: number;
}

/** Ordered ascending — the last tier whose threshold is met applies. */
export const LOYALTY_TIERS: readonly LoyaltyTier[] = [
  { id: "BRONZE", labelBn: "ব্রোঞ্জ", labelEn: "Bronze", minLifetimePoints: 0 },
  { id: "SILVER", labelBn: "সিলভার", labelEn: "Silver", minLifetimePoints: 500 },
  { id: "GOLD", labelBn: "গোল্ড", labelEn: "Gold", minLifetimePoints: 2000 },
  { id: "PLATINUM", labelBn: "প্লাটিনাম", labelEn: "Platinum", minLifetimePoints: 5000 },
];

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

export type ReferralStatus = "PENDING" | "QUALIFIED" | "REWARDED" | "REJECTED";

export interface Referral {
  id: string;
  referrerCustomerId: string;
  refereeCustomerId: string;
  code: string;
  status: ReferralStatus;
  /** The referee's first delivered order that qualified the referral. */
  qualifyingOrderId: string | null;
  createdAt: string;
  rewardedAt: string | null;
}

export type ReferralValidationError =
  | "SELF_REFERRAL"
  | "SAME_PHONE"
  | "DUPLICATE_REFEREE"
  | "CODE_NOT_FOUND";

// ---------------------------------------------------------------------------
// Affiliate
// ---------------------------------------------------------------------------

export type AffiliateStatus = "ACTIVE" | "SUSPENDED";

export interface AffiliatePartner {
  id: string;
  name: string;
  /** Attribution code used in links, e.g. "AFF-RAHIM10". */
  code: string;
  commissionBps: number;
  status: AffiliateStatus;
  createdAt: string;
}

/** A recorded affiliate touch — the 30-day cookie window is this shape. */
export interface AffiliateAttribution {
  partnerId: string;
  visitorKey: string;
  touchedAt: string;
  /** touchedAt + cookie window; an order after this is not attributed. */
  expiresAt: string;
}

export type AffiliateCommissionStatus = "PENDING" | "PAYABLE" | "PAID" | "VOID";

export interface AffiliateCommissionEntry {
  id: string;
  partnerId: string;
  orderId: string;
  orderTotalPoisha: number;
  commissionBps: number;
  commissionPoisha: number;
  status: AffiliateCommissionStatus;
  /** When the order was delivered (ISO); payable only after the return window. */
  deliveredAt: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Zod schemas (API input)
// ---------------------------------------------------------------------------

export const adjustPointsSchema = z.object({
  customerId: z.string().min(1),
  /** Non-zero signed point adjustment. */
  points: z.number().int().refine((v) => v !== 0, "points must be non-zero"),
  /** Adjustments are sensitive actions — a reason is always required. */
  reason: z.string().trim().min(3, "reason is required for point adjustments"),
});
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;
