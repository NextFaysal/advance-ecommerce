/**
 * Loyalty points — pure logic (Agent 36).
 *
 * The ledger is append-only. Balances are DERIVED, never stored:
 * EARN/positive-ADJUST entries form lots (FIFO); REDEEM/EXPIRE/negative-
 * ADJUST entries consume the oldest lots first. A lot whose expiry has
 * passed contributes nothing to the available balance even before the
 * EXPIRE sweep entry is written.
 */
import {
  DEFAULT_LOYALTY_CONFIG,
  LOYALTY_TIERS,
  type LoyaltyConfig,
  type LoyaltyTier,
  type PointsLedgerEntry,
} from "./types";

// ---------------------------------------------------------------------------
// Earning
// ---------------------------------------------------------------------------

/** Points earned for a delivered order total (integer poisha). */
export function computeEarnedPoints(orderTotalPoisha: number, config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG): number {
  if (orderTotalPoisha <= 0) return 0;
  return Math.floor(orderTotalPoisha / 100) * config.earnPointsPer100Poisha;
}

export function buildEarnEntry(input: {
  id: string;
  customerId: string;
  orderId: string;
  orderTotalPoisha: number;
  nowIso: string;
  config?: LoyaltyConfig;
}): PointsLedgerEntry | null {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  const points = computeEarnedPoints(input.orderTotalPoisha, config);
  if (points <= 0) return null;
  const expiresAt = new Date(new Date(input.nowIso).getTime() + config.pointsExpiryDays * 86_400_000).toISOString();
  return {
    id: input.id,
    customerId: input.customerId,
    type: "EARN",
    points,
    orderId: input.orderId,
    reason: null,
    expiresAt,
    createdAt: input.nowIso,
  };
}

// ---------------------------------------------------------------------------
// Balance derivation (FIFO lots)
// ---------------------------------------------------------------------------

interface Lot {
  remaining: number;
  expiresAt: string | null;
}

/** Fold entries (oldest first) into lots, consuming FIFO. Internal. */
function foldLots(entries: readonly PointsLedgerEntry[]): Lot[] {
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lots: Lot[] = [];
  const consume = (amount: number) => {
    let left = amount;
    for (const lot of lots) {
      if (left <= 0) break;
      const take = Math.min(lot.remaining, left);
      lot.remaining -= take;
      left -= take;
    }
  };
  for (const entry of ordered) {
    if (entry.type === "EARN" || (entry.type === "ADJUST" && entry.points > 0)) {
      lots.push({ remaining: entry.points, expiresAt: entry.expiresAt });
    } else if (entry.points < 0) {
      consume(-entry.points);
    }
  }
  return lots;
}

/** Points the customer can actually spend at `nowIso` (expired lots excluded). */
export function availableBalance(entries: readonly PointsLedgerEntry[], nowIso: string): number {
  const now = new Date(nowIso).getTime();
  return foldLots(entries)
    .filter((lot) => lot.remaining > 0 && (lot.expiresAt === null || new Date(lot.expiresAt).getTime() > now))
    .reduce((sum, lot) => sum + lot.remaining, 0);
}

/** All-time earned points (EARN + positive ADJUST), for tier calculation. */
export function lifetimeEarnedPoints(entries: readonly PointsLedgerEntry[]): number {
  return entries
    .filter((e) => (e.type === "EARN" || e.type === "ADJUST") && e.points > 0)
    .reduce((sum, e) => sum + e.points, 0);
}

export function tierForLifetimePoints(lifetimePoints: number): LoyaltyTier {
  let current: LoyaltyTier = LOYALTY_TIERS[0];
  for (const tier of LOYALTY_TIERS) {
    if (lifetimePoints >= tier.minLifetimePoints) current = tier;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Redeem / expire / adjust — each returns a NEW entry to append, never edits
// ---------------------------------------------------------------------------

export type RedeemResult =
  | { ok: true; entry: PointsLedgerEntry }
  | { ok: false; code: "INSUFFICIENT_POINTS" | "INVALID_POINTS"; message: string };

export function buildRedeemEntry(input: {
  id: string;
  customerId: string;
  orderId: string;
  points: number;
  entries: readonly PointsLedgerEntry[];
  nowIso: string;
}): RedeemResult {
  if (!Number.isInteger(input.points) || input.points <= 0) {
    return { ok: false, code: "INVALID_POINTS", message: "Points to redeem must be a positive integer." };
  }
  const balance = availableBalance(input.entries, input.nowIso);
  if (input.points > balance) {
    return { ok: false, code: "INSUFFICIENT_POINTS", message: `Redeem ${input.points} exceeds available balance ${balance}.` };
  }
  return {
    ok: true,
    entry: {
      id: input.id,
      customerId: input.customerId,
      type: "REDEEM",
      points: -input.points,
      orderId: input.orderId,
      reason: null,
      expiresAt: null,
      createdAt: input.nowIso,
    },
  };
}

/** EXPIRE entry for every lot already past expiry (or null if none). */
export function buildExpirySweepEntry(input: {
  id: string;
  customerId: string;
  entries: readonly PointsLedgerEntry[];
  nowIso: string;
}): PointsLedgerEntry | null {
  const now = new Date(input.nowIso).getTime();
  const expired = foldLots(input.entries)
    .filter((lot) => lot.remaining > 0 && lot.expiresAt !== null && new Date(lot.expiresAt).getTime() <= now)
    .reduce((sum, lot) => sum + lot.remaining, 0);
  if (expired <= 0) return null;
  return {
    id: input.id,
    customerId: input.customerId,
    type: "EXPIRE",
    points: -expired,
    orderId: null,
    reason: "Points expiry sweep",
    expiresAt: null,
    createdAt: input.nowIso,
  };
}

/** Manual adjustment (admin). Reason is mandatory — enforced by the schema. */
export function buildAdjustEntry(input: {
  id: string;
  customerId: string;
  points: number;
  reason: string;
  entries: readonly PointsLedgerEntry[];
  nowIso: string;
}): RedeemResult {
  if (input.points < 0) {
    const balance = availableBalance(input.entries, input.nowIso);
    if (-input.points > balance) {
      return { ok: false, code: "INSUFFICIENT_POINTS", message: `Negative adjustment exceeds available balance ${balance}.` };
    }
  }
  return {
    ok: true,
    entry: {
      id: input.id,
      customerId: input.customerId,
      type: "ADJUST",
      points: input.points,
      orderId: null,
      reason: input.reason,
      expiresAt: null,
      createdAt: input.nowIso,
    },
  };
}

// ---------------------------------------------------------------------------
// Checkout redemption — an INPUT SHAPE for the pricing pipeline.
// The pipeline order is: subtotal -> item discounts -> coupon/campaign ->
// shipping -> COD fee -> tax -> total. A loyalty redemption is an item-
// discount-stage input: checkout converts chosen points through this
// function and passes `discountPoisha` in as a discount line. This module
// does NOT edit checkout; it only defines the contract.
// ---------------------------------------------------------------------------

export interface LoyaltyDiscountInput {
  pointsUsed: number;
  discountPoisha: number;
  cappedBy: "BALANCE" | "SUBTOTAL_CAP" | null;
}

export function pointsToDiscountPoisha(input: {
  requestedPoints: number;
  availablePoints: number;
  subtotalPoisha: number;
  config?: LoyaltyConfig;
}): LoyaltyDiscountInput {
  const config = input.config ?? DEFAULT_LOYALTY_CONFIG;
  const requested = Math.max(0, Math.floor(input.requestedPoints));
  let pointsUsed = Math.min(requested, Math.max(0, input.availablePoints));
  let cappedBy: LoyaltyDiscountInput["cappedBy"] = pointsUsed < requested ? "BALANCE" : null;
  const capPoisha = Math.floor((input.subtotalPoisha * config.maxRedeemBpsOfSubtotal) / 10_000);
  const maxPointsByCap = Math.floor(capPoisha / config.redeemPoishaPerPoint);
  if (pointsUsed > maxPointsByCap) {
    pointsUsed = maxPointsByCap;
    cappedBy = "SUBTOTAL_CAP";
  }
  return { pointsUsed, discountPoisha: pointsUsed * config.redeemPoishaPerPoint, cappedBy };
}
