/**
 * EMI / BNPL presentation — ADV-18B (doc 22). DISPLAY ONLY.
 *
 * EMI here is a presentation of bank-card instalment terms: the
 * breakdown is computed from Admin Settings (payments.emi.*) and
 * shown on the PDP and at checkout with the label "EMI সুবিধা
 * ব্যাংক কার্ডে — চূড়ান্ত শর্ত ব্যাংকের" (final terms are the
 * bank's). There is NO EMI gateway and NO change to any amount
 * charged — checkout charges the full order total through the
 * customer's chosen payment method, exactly as before.
 *
 * BNPL: no BNPL provider exists in this codebase, so nothing BNPL
 * is rendered anywhere. (If a provider lands later it gets its own
 * adapter slice; a display-only BNPL badge would be a fake option.)
 *
 * Math: surchargeBps applies ONCE over the whole tenure (not per
 * month): totalWithSurcharge = total + floor(total * bps / 10000).
 * The monthly split uses largest-remainder so the instalments sum
 * EXACTLY to totalWithSurcharge — no paisa invented or lost.
 */
import { getSetting } from "@/lib/settings";

export interface EmiConfig {
  enabled: boolean;
  /** Tenures on offer, ascending, e.g. [3, 6, 12]. */
  months: number[];
  surchargeBps: number;
  minOrderPoisha: number;
}

export const EMI_DISABLED: EmiConfig = { enabled: false, months: [], surchargeBps: 0, minOrderPoisha: 0 };

export function parseEmiConfig(raw: {
  enabled: string | null;
  months: string | null;
  surchargeBps: string | null;
  minOrderPoisha: string | null;
}): EmiConfig {
  const months = (raw.months ?? "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 2 && n <= 36);
  const uniqueSorted = [...new Set(months)].sort((a, b) => a - b);
  const bps = Number.parseInt(raw.surchargeBps ?? "0", 10);
  const min = Number.parseInt(raw.minOrderPoisha ?? "0", 10);
  return {
    enabled: raw.enabled === "true" && uniqueSorted.length > 0,
    months: uniqueSorted,
    surchargeBps: Number.isFinite(bps) ? Math.min(10000, Math.max(0, bps)) : 0,
    minOrderPoisha: Number.isFinite(min) ? Math.max(0, min) : 0,
  };
}

export async function loadEmiConfig(): Promise<EmiConfig> {
  const [enabled, months, surchargeBps, minOrderPoisha] = await Promise.all([
    getSetting("payments.emi.enabled"),
    getSetting("payments.emi.months"),
    getSetting("payments.emi.surcharge_bps"),
    getSetting("payments.emi.min_order_poisha"),
  ]);
  return parseEmiConfig({ enabled, months, surchargeBps, minOrderPoisha });
}

export interface EmiTenureBreakdown {
  months: number;
  surchargePoisha: number;
  totalWithSurchargePoisha: number;
  /** Per-month amounts; sums EXACTLY to totalWithSurchargePoisha. */
  monthlyPoisha: number[];
  /** The amount shown as "per month" (first instalment). */
  perMonthPoisha: number;
}

/** Split a total into `parts` integer amounts that sum exactly. */
export function splitExact(totalPoisha: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.floor(totalPoisha / parts);
  const remainder = totalPoisha - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function computeEmiBreakdown(totalPoisha: number, config: EmiConfig): EmiTenureBreakdown[] {
  if (!config.enabled || totalPoisha < config.minOrderPoisha || totalPoisha <= 0) return [];
  return config.months.map((months) => {
    const surchargePoisha = Math.floor((totalPoisha * config.surchargeBps) / 10000);
    const totalWithSurchargePoisha = totalPoisha + surchargePoisha;
    const monthlyPoisha = splitExact(totalWithSurchargePoisha, months);
    return {
      months,
      surchargePoisha,
      totalWithSurchargePoisha,
      monthlyPoisha,
      perMonthPoisha: monthlyPoisha[0] ?? 0,
    };
  });
}

/** The public shape the checkout client component may see — config
 *  values only, all of them display data by design. */
export interface PublicEmiConfig {
  enabled: boolean;
  months: number[];
  surchargeBps: number;
  minOrderPoisha: number;
  labelBn: string;
}

export const EMI_LABEL_BN = "EMI সুবিধা ব্যাংক কার্ডে — চূড়ান্ত শর্ত ব্যাংকের";

export function toPublicEmiConfig(config: EmiConfig): PublicEmiConfig {
  return {
    enabled: config.enabled,
    months: config.months,
    surchargeBps: config.surchargeBps,
    minOrderPoisha: config.minOrderPoisha,
    labelBn: EMI_LABEL_BN,
  };
}
