/**
 * Order-line quantity rules — doc 23 wave 59 (fractional quantities).
 *
 * Zod proves a quantity is REPRESENTABLE (positive, <= 3 decimals);
 * this module proves it is SELLABLE:
 *
 *  - A NON-weighted variant may only be ordered in whole units. A
 *    fractional quantity for one is a clear 400
 *    (FRACTIONAL_QUANTITY_NOT_ALLOWED) — never silently rounded.
 *  - A variant is "weighted" (sold by weight) exactly when the ADV-22
 *    grocery pack is ENABLED and the variant is listed in its
 *    weightedVariants config — the same marker the PDP/cart annotate
 *    from. There is no second definition of weighted-ness.
 *  - For a weighted variant the quantity is a multiple of the pack:
 *    total grams = qty × packGrams must land on the pack's configured
 *    weight step (weightStepGrams, default 250 g) and stay under the
 *    per-item cap (maxWeightGramsPerItem). Violations are 400s naming
 *    the rule (WEIGHT_STEP_MISMATCH / WEIGHT_LIMIT_EXCEEDED).
 *
 * All checks run in integer milli-units (src/lib/quantity.ts), so a
 * quantity like 0.29 is judged exactly, never by float comparison.
 * Callers: public checkout, createManualOrder (which also covers
 * drafts, inbox conversion, CSV import, B2B conversion, subscription
 * generation and abandoned-checkout conversion), order edit, and the
 * subscription service.
 */
import { getEnabledPackConfig } from "@/business-modules/config-store";
import {
  weightedVariantFor,
  type GroceryConfig,
} from "@/business-modules/grocery";
import {
  isFractionalQty,
  isValidQtyNumber,
  qtyToMilli,
  qtyToString,
  QTY_MILLI,
} from "@/lib/quantity";

export interface QuantityRuleFailure {
  ok: false;
  code: "FRACTIONAL_QUANTITY_NOT_ALLOWED" | "WEIGHT_STEP_MISMATCH" | "WEIGHT_LIMIT_EXCEEDED" | "VALIDATION_ERROR";
  message: string;
  details: { variantId: string; quantity: string }[];
}

export type QuantityRuleResult = { ok: true } | QuantityRuleFailure;

export interface QuantityLineInput {
  variantId: string;
  quantity: number;
}

/**
 * Validate a set of order lines against the weighted rules. Loads the
 * grocery pack config at most once per call; when the pack is off,
 * every variant is non-weighted and only the integer rule applies.
 */
export async function validateOrderLineQuantities(
  items: readonly QuantityLineInput[],
): Promise<QuantityRuleResult> {
  const config = await getEnabledPackConfig<GroceryConfig>("grocery");
  const failures: QuantityRuleFailure["details"] = [];
  let failureCode: QuantityRuleFailure["code"] = "FRACTIONAL_QUANTITY_NOT_ALLOWED";
  let failureMessage = "";

  for (const item of items) {
    const detail = { variantId: item.variantId, quantity: qtyToString(item.quantity) };
    if (!isValidQtyNumber(item.quantity)) {
      failures.push(detail);
      failureCode = "VALIDATION_ERROR";
      failureMessage =
        "পরিমাণ ধনাত্মক হতে হবে এবং সর্বোচ্চ ৩ দশমিক স্থান পর্যন্ত হতে পারবে। / Quantity must be positive with at most 3 decimal places.";
      continue;
    }
    const weighted = config ? weightedVariantFor(config, item.variantId) : null;
    if (!weighted) {
      if (isFractionalQty(item.quantity)) {
        failures.push(detail);
        failureCode = "FRACTIONAL_QUANTITY_NOT_ALLOWED";
        failureMessage =
          "এই পণ্যটি ভগ্নাংশ পরিমাণে বিক্রি হয় না — পূর্ণ সংখ্যায় অর্ডার করুন। / This product is not sold in fractional quantities — please order a whole number of units.";
      }
      continue;
    }
    // Weighted line: qty is a multiple of the configured pack.
    // gramsMilli = qtyMilli × packGrams is exact integer math.
    // (weighted non-null implies config non-null — weightedVariantFor
    // only reads from a loaded config.)
    const cfg = config as NonNullable<typeof config>;
    const gramsMilli = qtyToMilli(item.quantity) * weighted.packGrams;
    const stepMilli = cfg.weightStepGrams * QTY_MILLI;
    if (gramsMilli % stepMilli !== 0) {
      failures.push(detail);
      failureCode = "WEIGHT_STEP_MISMATCH";
      failureMessage = `ওজন ${cfg.weightStepGrams} গ্রামের ধাপে হতে হবে। / Weight must be in steps of ${cfg.weightStepGrams} g.`;
      continue;
    }
    if (gramsMilli > cfg.maxWeightGramsPerItem * QTY_MILLI) {
      failures.push(detail);
      failureCode = "WEIGHT_LIMIT_EXCEEDED";
      failureMessage = `একটি আইটেমের সর্বোচ্চ ওজন ${cfg.maxWeightGramsPerItem} গ্রাম। / Maximum weight per item is ${cfg.maxWeightGramsPerItem} g.`;
    }
  }

  if (failures.length > 0) {
    return { ok: false, code: failureCode, message: failureMessage, details: failures };
  }
  return { ok: true };
}

/**
 * The quantity step a PDP/cart stepper should use for one variant:
 * for a weighted variant, the configured weight step expressed in
 * pack units (weightStepGrams / packGrams — e.g. 250 g of a 1000 g
 * pack = 0.25), so stepped quantities always satisfy the server rule
 * above; null for non-weighted variants (integer stepping).
 */
export function weightedStepQuantity(
  config: GroceryConfig,
  variantId: string,
): number | null {
  const weighted = weightedVariantFor(config, variantId);
  if (!weighted) return null;
  const stepMilli = Math.round((config.weightStepGrams * QTY_MILLI) / weighted.packGrams);
  return Math.max(1, stepMilli) / QTY_MILLI;
}
