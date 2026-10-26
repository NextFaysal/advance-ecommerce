/**
 * Reseller pricing + tier logic — pure, integer poisha only. Agent 14.
 *
 * Rules (hard, never coerced):
 * - margin = resellerPrice - basePrice. A resellerPrice below basePrice is a
 *   validation ERROR; we never silently clamp it up to basePrice, because
 *   that would change the price the reseller actually set.
 * - Commission = floor(salesAmount * bps / 10000), rounded DOWN once, so the
 *   store never pays out fractional poisha it did not collect.
 */
import {
  TIER_COMMISSION_BPS,
  TIER_THRESHOLDS_POISHA,
  type ResellerPriceEntry,
  type ResellerPriceInput,
  type ResellerTier,
} from "./types";

export type MarginResult =
  | { ok: true; marginPoisha: number; marginBps: number }
  | { ok: false; error: string };

/** Margin for one price entry. marginBps is margin as a share of the selling price. */
export function computeMargin(input: ResellerPriceInput): MarginResult {
  const { basePricePoisha, resellerPricePoisha } = input;
  if (!Number.isInteger(basePricePoisha) || !Number.isInteger(resellerPricePoisha)) {
    return { ok: false, error: "Price must be integer poisha." };
  }
  if (basePricePoisha < 0 || resellerPricePoisha < 0) {
    return { ok: false, error: "Price cannot be negative." };
  }
  const marginPoisha = resellerPricePoisha - basePricePoisha;
  if (marginPoisha < 0) {
    return {
      ok: false,
      error: `Reseller price (${resellerPricePoisha}) cannot be below base price (${basePricePoisha}). Margin would be negative.`,
    };
  }
  const marginBps =
    resellerPricePoisha === 0 ? 0 : Math.floor((marginPoisha * 10_000) / resellerPricePoisha);
  return { ok: true, marginPoisha, marginBps };
}

/** Validate + build a full price entry, or return the margin error. */
export function buildPriceEntry(
  catalog: { variantId: string; sku: string; productName: string },
  input: ResellerPriceInput,
): { ok: true; entry: ResellerPriceEntry } | { ok: false; error: string } {
  if (catalog.variantId !== input.variantId) {
    return { ok: false, error: "Variant mismatch between catalog entry and price input." };
  }
  const margin = computeMargin(input);
  if (!margin.ok) return margin;
  return {
    ok: true,
    entry: {
      variantId: catalog.variantId,
      sku: catalog.sku,
      productName: catalog.productName,
      basePricePoisha: input.basePricePoisha,
      resellerPricePoisha: input.resellerPricePoisha,
    },
  };
}

/**
 * @deprecated Sales-based tier derivation (pre-ADV-12). The live engine
 * is tierForLifetimeCommission in ./tiers — tiers derive from lifetime
 * earned COMMISSION with Settings-driven rates/thresholds. Kept only
 * so older imports keep compiling; do not use in new code.
 */
export function tierForLifetimeSales(lifetimeSalesPoisha: number): ResellerTier {
  if (lifetimeSalesPoisha >= TIER_THRESHOLDS_POISHA.GOLD) return "GOLD";
  if (lifetimeSalesPoisha >= TIER_THRESHOLDS_POISHA.SILVER) return "SILVER";
  return "BRONZE";
}

/** @deprecated Sales-based progress — see tierForLifetimeSales. Use nextTierProgressForCommission (./tiers). */
export function nextTierProgress(lifetimeSalesPoisha: number): {
  nextTier: ResellerTier | null;
  toNextTierPoisha: number;
} {
  const tier = tierForLifetimeSales(lifetimeSalesPoisha);
  if (tier === "GOLD") return { nextTier: null, toNextTierPoisha: 0 };
  const next: ResellerTier = tier === "BRONZE" ? "SILVER" : "GOLD";
  return {
    nextTier: next,
    toNextTierPoisha: TIER_THRESHOLDS_POISHA[next] - lifetimeSalesPoisha,
  };
}

/**
 * @deprecated Fixed-rate commission on the sales ladder. The live
 * credit path computes commissionForAmountPoisha(amount, tierRateBps)
 * from the Settings-loaded TierConfig (./tiers + ./tier-config).
 */
export function commissionForSale(saleAmountPoisha: number, tier: ResellerTier): number {
  if (saleAmountPoisha <= 0) return 0;
  return Math.floor((saleAmountPoisha * TIER_COMMISSION_BPS[tier]) / 10_000);
}
