/**
 * Membership tiers — ADV-18 (doc 22), marketing mechanics pack.
 *
 * Customer loyalty tiers (distinct from the reseller tiers of
 * ADV-12 and from the points ledger in src/loyalty): a customer's
 * tier is DERIVED from lifetime spend — the sum of totalPoisha over
 * their DELIVERED orders — never stored, so it can never go stale.
 *
 * The ladder + benefits live in ONE Settings document,
 * `loyalty.tiers.config` (JSON):
 *   { "tiers": [ { key, labelBn, labelEn, thresholdPoisha,
 *                  discountBps, freeShipping }, ... ] }
 * ordered lowest first; the first tier's threshold is always 0.
 * parseMembershipTierConfig validates per-field and falls back to
 * DEFAULT_MEMBERSHIP_TIERS for anything broken — a scrambled ladder
 * (non-monotonic thresholds) falls back as a whole, mirroring the
 * reseller tier engine's discipline.
 *
 * Benefits, applied in the public checkout route (the same pricing
 * seam coupons use):
 *  - discountBps: a merchandise discount on (subtotal − coupon),
 *    folded into the pipeline's discount stage and the Order row's
 *    discountPoisha, reported separately in the response.
 *  - freeShipping: the order's shipping charge becomes 0.
 * Everything here is gated by the module.marketing_mechanics flag at
 * the call sites; this module is pure/config logic + one read model.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";

export interface MembershipTier {
  key: string;
  labelBn: string;
  labelEn: string;
  /** Lifetime DELIVERED spend (poisha) required to reach this tier. */
  thresholdPoisha: number;
  /** Merchandise discount at checkout, basis points (0..10000). */
  discountBps: number;
  freeShipping: boolean;
}

export const DEFAULT_MEMBERSHIP_TIERS: readonly MembershipTier[] = [
  { key: "REGULAR", labelBn: "সাধারণ", labelEn: "Regular", thresholdPoisha: 0, discountBps: 0, freeShipping: false },
  { key: "SILVER", labelBn: "সিলভার", labelEn: "Silver", thresholdPoisha: 5_000_000, discountBps: 200, freeShipping: false },
  { key: "GOLD", labelBn: "গোল্ড", labelEn: "Gold", thresholdPoisha: 20_000_000, discountBps: 500, freeShipping: true },
  { key: "PLATINUM", labelBn: "প্লাটিনাম", labelEn: "Platinum", thresholdPoisha: 50_000_000, discountBps: 1000, freeShipping: true },
];

/* ------------------------------------------------------------------ */
/* Config parsing (pure)                                               */
/* ------------------------------------------------------------------ */

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function parseTier(raw: unknown, fallback: MembershipTier): MembershipTier {
  if (typeof raw !== "object" || raw === null) return fallback;
  const r = raw as Record<string, unknown>;
  return {
    key: typeof r.key === "string" && r.key.trim() !== "" ? r.key.trim() : fallback.key,
    labelBn: typeof r.labelBn === "string" && r.labelBn !== "" ? r.labelBn : fallback.labelBn,
    labelEn: typeof r.labelEn === "string" && r.labelEn !== "" ? r.labelEn : fallback.labelEn,
    thresholdPoisha: isIntInRange(r.thresholdPoisha, 0, Number.MAX_SAFE_INTEGER)
      ? r.thresholdPoisha
      : fallback.thresholdPoisha,
    discountBps: isIntInRange(r.discountBps, 0, 10_000) ? r.discountBps : fallback.discountBps,
    freeShipping: typeof r.freeShipping === "boolean" ? r.freeShipping : fallback.freeShipping,
  };
}

/**
 * Parse the Settings JSON document into a ladder. Rules: the array
 * must be non-empty; the first tier's threshold is forced to 0 (the
 * base tier always applies); thresholds must be non-decreasing or
 * the whole ladder falls back to defaults (a scrambled ladder would
 * make derivation unpredictable).
 */
export function parseMembershipTierConfig(raw: string | null): MembershipTier[] {
  if (!raw) return [...DEFAULT_MEMBERSHIP_TIERS];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [...DEFAULT_MEMBERSHIP_TIERS];
  }
  const rawTiers = (parsed as { tiers?: unknown })?.tiers;
  if (!Array.isArray(rawTiers) || rawTiers.length === 0) return [...DEFAULT_MEMBERSHIP_TIERS];
  const tiers = rawTiers.map((t, i) =>
    parseTier(t, DEFAULT_MEMBERSHIP_TIERS[i] ?? (DEFAULT_MEMBERSHIP_TIERS[0] as MembershipTier)),
  );
  tiers[0] = { ...(tiers[0] as MembershipTier), thresholdPoisha: 0 };
  const monotonic = tiers.every((t, i) => i === 0 || t.thresholdPoisha >= (tiers[i - 1] as MembershipTier).thresholdPoisha);
  if (!monotonic) return [...DEFAULT_MEMBERSHIP_TIERS];
  return tiers;
}

export async function loadMembershipTierConfig(): Promise<MembershipTier[]> {
  return parseMembershipTierConfig(await getSetting("loyalty.tiers.config"));
}

/* ------------------------------------------------------------------ */
/* Derivation (pure)                                                   */
/* ------------------------------------------------------------------ */

export interface MembershipTierState {
  tier: MembershipTier;
  lifetimeSpendPoisha: number;
  /** Next tier up, or null at the top of the ladder. */
  nextTier: MembershipTier | null;
  /** Poisha of lifetime spend still needed to reach nextTier. */
  toNextTierPoisha: number;
  /** Progress toward the next tier, basis points of the gap (0..10000). */
  progressBps: number;
}

export function deriveMembershipTier(
  lifetimeSpendPoisha: number,
  tiers: readonly MembershipTier[],
): MembershipTierState {
  let idx = 0;
  for (let i = 0; i < tiers.length; i++) {
    if (lifetimeSpendPoisha >= (tiers[i] as MembershipTier).thresholdPoisha) idx = i;
  }
  const tier = tiers[idx] as MembershipTier;
  const nextTier = tiers[idx + 1] ?? null;
  if (!nextTier) {
    return { tier, lifetimeSpendPoisha, nextTier: null, toNextTierPoisha: 0, progressBps: 10_000 };
  }
  const gap = nextTier.thresholdPoisha - tier.thresholdPoisha;
  const into = lifetimeSpendPoisha - tier.thresholdPoisha;
  return {
    tier,
    lifetimeSpendPoisha,
    nextTier,
    toNextTierPoisha: Math.max(0, nextTier.thresholdPoisha - lifetimeSpendPoisha),
    progressBps: gap > 0 ? Math.min(10_000, Math.floor((into * 10_000) / gap)) : 10_000,
  };
}

/** Tier merchandise discount for a post-coupon merchandise base:
 *  floor(base * bps / 10000), rounded DOWN once (reseller convention). */
export function tierDiscountForBasePoisha(basePoisha: number, tier: MembershipTier): number {
  if (basePoisha <= 0 || tier.discountBps <= 0) return 0;
  return Math.floor((basePoisha * tier.discountBps) / 10_000);
}

/** Lifetime spend from order rows: DELIVERED orders only, as
 *  recorded on the Order rows (totalPoisha). Pure — the checkout
 *  route feeds it the prior-orders rows it already loaded. */
export function lifetimeDeliveredSpendPoisha(
  orders: readonly { status: string; totalPoisha: number }[],
): number {
  return orders.reduce((sum, o) => (o.status === "DELIVERED" ? sum + o.totalPoisha : sum), 0);
}

/* ------------------------------------------------------------------ */
/* Read model (account display)                                        */
/* ------------------------------------------------------------------ */

export async function getCustomerMembershipState(customerId: string): Promise<MembershipTierState> {
  const [agg, tiers] = await Promise.all([
    prisma.order.aggregate({
      where: { customerId, status: "DELIVERED", deletedAt: null },
      _sum: { totalPoisha: true },
    }),
    loadMembershipTierConfig(),
  ]);
  return deriveMembershipTier(agg._sum.totalPoisha ?? 0, tiers);
}
