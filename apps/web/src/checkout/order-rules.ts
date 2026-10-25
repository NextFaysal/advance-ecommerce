// Order-create rules (wave 20, plan 17 batch O2) — Settings-driven
// shop policy enforced at public order create time:
//
//   orders.rules.min_order_poisha               minimum merchandise
//                                               subtotal; 0 = off
//   orders.rules.cod_disabled_districts         comma/newline list of
//                                               districts where COD is
//                                               refused
//   orders.rules.cod_disabled_categories        comma/newline list of
//                                               category slugs; an order
//                                               containing any item from
//                                               a listed category
//                                               cannot be paid COD
//   orders.rules.advance_required_above_poisha  COD orders above this
//                                               grand total are flagged
//                                               advance-required;
//                                               0 = off
//   orders.rules.advance_percent                % of the grand total
//                                               asked as the advance
//                                               (default 20)
//
// Every rule defaults OFF / permissive, so an unconfigured shop checks
// out exactly as before this module existed. Rule loading FAILS OPEN:
// a settings read error yields the permissive defaults — a settings
// outage must never take checkout down with it.
//
// SCOPE (honest): this wave is plumbing. The advance flag is surfaced
// in the create response meta (and on the returned order) exactly like
// the fraud band's flag — nothing is persisted and nothing collects
// the advance yet; collection + confirmation gating are plan 17
// batch O3, which persists these as real Order columns.
import { getSetting } from "@/lib/settings";

export interface OrderRules {
  /** Minimum merchandise subtotal in poisha; 0 = rule off. */
  minOrderPoisha: number;
  /** Normalized (trimmed, lowercased) district names where COD is off. */
  codDisabledDistricts: readonly string[];
  /** Normalized category slugs: any item in one blocks COD. */
  codDisabledCategories: readonly string[];
  /** COD grand-total threshold in poisha; 0 = rule off. */
  advanceRequiredAbovePoisha: number;
  /** Advance percent of the grand total (1-100, default 20). */
  advancePercent: number;
}

export const PERMISSIVE_ORDER_RULES: OrderRules = {
  minOrderPoisha: 0,
  codDisabledDistricts: [],
  codDisabledCategories: [],
  advanceRequiredAbovePoisha: 0,
  advancePercent: 20,
};

function parsePoisha(raw: string | null): number {
  if (raw === null) return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Settings lists are comma- or newline-separated free text. */
function parseList(raw: string | null): string[] {
  if (raw === null) return [];
  return raw
    .split(/[,\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parsePercent(raw: string | null): number {
  if (raw === null) return 20;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isInteger(n) && n >= 1 && n <= 100 ? n : 20;
}

export async function loadOrderRules(): Promise<OrderRules> {
  try {
    const [minOrder, districts, categories, above, percent] = await Promise.all([
      getSetting("orders.rules.min_order_poisha"),
      getSetting("orders.rules.cod_disabled_districts"),
      getSetting("orders.rules.cod_disabled_categories"),
      getSetting("orders.rules.advance_required_above_poisha"),
      getSetting("orders.rules.advance_percent"),
    ]);
    return {
      minOrderPoisha: parsePoisha(minOrder),
      codDisabledDistricts: parseList(districts),
      codDisabledCategories: parseList(categories),
      advanceRequiredAbovePoisha: parsePoisha(above),
      advancePercent: parsePercent(percent),
    };
  } catch {
    return PERMISSIVE_ORDER_RULES;
  }
}

/* ------------------------------------------------------------------ */
/* Evaluation (pure)                                                   */
/* ------------------------------------------------------------------ */

export type CodViolation =
  | { rule: "orders.rules.cod_disabled_districts"; match: string }
  | { rule: "orders.rules.cod_disabled_categories"; match: string };

/**
 * COD availability for one order. `district` is the submitted address
 * district (geo-validated upstream by the checkout cascade) and
 * `categorySlugs` the distinct category slugs of the order's items —
 * both matched case-insensitively after trimming, mirroring how the
 * settings lists are parsed.
 */
export function codViolation(
  rules: OrderRules,
  input: { district: string; categorySlugs: readonly string[] },
): CodViolation | null {
  const district = input.district.trim().toLowerCase();
  if (district !== "" && rules.codDisabledDistricts.includes(district)) {
    return { rule: "orders.rules.cod_disabled_districts", match: district };
  }
  for (const slug of input.categorySlugs) {
    const normalized = slug.trim().toLowerCase();
    if (normalized !== "" && rules.codDisabledCategories.includes(normalized)) {
      return { rule: "orders.rules.cod_disabled_categories", match: normalized };
    }
  }
  return null;
}

/** Minimum-order check against the merchandise subtotal (pre-shipping). */
export function belowMinimum(rules: OrderRules, subtotalPoisha: number): boolean {
  return rules.minOrderPoisha > 0 && subtotalPoisha < rules.minOrderPoisha;
}

export interface AdvanceRuleResult {
  advanceRequired: boolean;
  /** Poisha asked as advance (percent of the grand total); 0 when off. */
  advancePoisha: number;
}

/**
 * The mandatory-advance rule: COD only (a prepaid method already
 * collects), grand total strictly above the configured threshold.
 */
export function evaluateAdvanceRule(
  rules: OrderRules,
  input: { paymentMethod: string; grandTotalPoisha: number },
): AdvanceRuleResult {
  if (
    rules.advanceRequiredAbovePoisha <= 0 ||
    input.paymentMethod !== "cod" ||
    input.grandTotalPoisha <= rules.advanceRequiredAbovePoisha
  ) {
    return { advanceRequired: false, advancePoisha: 0 };
  }
  return {
    advanceRequired: true,
    advancePoisha: Math.round((input.grandTotalPoisha * rules.advancePercent) / 100),
  };
}
