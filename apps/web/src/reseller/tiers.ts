/**
 * Reseller tier engine — ADV-12 (doc 22). Pure logic, integer poisha only.
 *
 * Tier is DERIVED from lifetime earned COMMISSION (the sum of
 * COMMISSION_CREDIT wallet entries) — never from sales volume and never
 * trusted from the stored Reseller.tier column (that column is a display
 * cache refreshed at credit time by store.creditDeliveredOrderDb).
 *
 * Rates (basis points) and thresholds (lifetime commission poisha needed
 * to REACH a tier) are configurable via Settings keys
 *   reseller.tiers.rates_bps          JSON {"BRONZE":500,...}
 *   reseller.tiers.thresholds_poisha  JSON {"BRONZE":0,...}
 * loaded by tier-config.ts; anything missing/invalid falls back
 * per-field to DEFAULT_TIER_CONFIG below, so a partial or broken
 * Settings value can never produce a nonsense tier ladder.
 */
import { RESELLER_TIERS, TIER_COMMISSION_BPS, type ResellerTier, type WalletEntry } from "./types";

export interface TierConfig {
  /** Commission rate per tier, basis points (0..10000). */
  ratesBps: Record<ResellerTier, number>;
  /** Lifetime earned commission (poisha) required to reach the tier. BRONZE is always 0. */
  thresholdsPoisha: Record<ResellerTier, number>;
}

/** Built-in defaults — mirrored as the SETTING_DEFAULTS values for reseller.tiers.*. */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  ratesBps: { ...TIER_COMMISSION_BPS },
  thresholdsPoisha: {
    BRONZE: 0,
    SILVER: 2_500_000, // ৳25,000 lifetime commission
    GOLD: 10_000_000, // ৳1,00,000 lifetime commission
    PLATINUM: 50_000_000, // ৳5,00,000 lifetime commission
  },
};

/** Lifetime earned commission from a wallet ledger: Σ COMMISSION_CREDIT only. */
export function lifetimeCommissionPoisha(entries: readonly Pick<WalletEntry, "type" | "amountPoisha">[]): number {
  return entries.reduce((sum, e) => (e.type === "COMMISSION_CREDIT" ? sum + e.amountPoisha : sum), 0);
}

/** Tier for a lifetime earned-commission total. Pure function of the total + config. */
export function tierForLifetimeCommission(lifetimeCommission: number, config: TierConfig): ResellerTier {
  let tier: ResellerTier = "BRONZE";
  for (const candidate of RESELLER_TIERS) {
    if (lifetimeCommission >= config.thresholdsPoisha[candidate]) tier = candidate;
  }
  return tier;
}

/** The commission rate (bps) a tier earns under this config. */
export function tierRateBps(tier: ResellerTier, config: TierConfig): number {
  return config.ratesBps[tier];
}

/** Next tier + remaining lifetime commission (poisha) to reach it. At PLATINUM, nextTier is null. */
export function nextTierProgressForCommission(
  lifetimeCommission: number,
  config: TierConfig,
): { nextTier: ResellerTier | null; toNextTierPoisha: number } {
  const tier = tierForLifetimeCommission(lifetimeCommission, config);
  const idx = RESELLER_TIERS.indexOf(tier);
  if (idx === RESELLER_TIERS.length - 1) return { nextTier: null, toNextTierPoisha: 0 };
  const next = RESELLER_TIERS[idx + 1] as ResellerTier;
  return { nextTier: next, toNextTierPoisha: Math.max(0, config.thresholdsPoisha[next] - lifetimeCommission) };
}

/** Commission for an amount at a rate: floor(amount * bps / 10000), rounded DOWN once. */
export function commissionForAmountPoisha(amountPoisha: number, rateBps: number): number {
  if (amountPoisha <= 0 || rateBps <= 0) return 0;
  return Math.floor((amountPoisha * rateBps) / 10_000);
}

function isIntInRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

function parseTierMap(
  raw: string | null,
  fallback: Record<ResellerTier, number>,
  min: number,
  max: number,
): Record<ResellerTier, number> {
  if (!raw) return { ...fallback };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...fallback };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...fallback };
  const out = { ...fallback };
  for (const tier of RESELLER_TIERS) {
    const v = (parsed as Record<string, unknown>)[tier];
    if (isIntInRange(v, min, max)) out[tier] = v;
  }
  return out;
}

/**
 * Build a TierConfig from the two raw Settings values. Per-field
 * fallback; the thresholds ladder must be non-decreasing with BRONZE = 0
 * or the WHOLE thresholds map falls back (a scrambled ladder would make
 * tier derivation unpredictable).
 */
export function parseTierConfig(rawRates: string | null, rawThresholds: string | null): TierConfig {
  const ratesBps = parseTierMap(rawRates, DEFAULT_TIER_CONFIG.ratesBps, 0, 10_000);
  let thresholdsPoisha = parseTierMap(rawThresholds, DEFAULT_TIER_CONFIG.thresholdsPoisha, 0, Number.MAX_SAFE_INTEGER);
  const ladder = RESELLER_TIERS.map((t) => thresholdsPoisha[t]);
  const monotonic = ladder.every((v, i) => i === 0 || v >= (ladder[i - 1] as number));
  if (!monotonic || thresholdsPoisha.BRONZE !== 0) {
    thresholdsPoisha = { ...DEFAULT_TIER_CONFIG.thresholdsPoisha };
  }
  return { ratesBps, thresholdsPoisha };
}
