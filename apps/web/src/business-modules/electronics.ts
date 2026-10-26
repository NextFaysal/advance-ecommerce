/**
 * Electronics pack — Agent 17, Step 49 (Part C).
 * Warranty terms + EMI (instalment) calculator. All money is integer
 * poisha; EMI splits use integer division with the remainder spread over
 * the FIRST instalments, so the instalments always sum exactly to the
 * financed total — no float, no rounding loss.
 */
import { z } from "zod";
import type { BusinessModulePack, PackValidation } from "./types";

export const electronicsConfigSchema = z.object({
  /** Default warranty length applied to electronics products. */
  defaultWarrantyMonths: z.number().int().min(0).max(120).default(12),
  /** EMI tenures (months) offered at checkout. */
  emiTenuresMonths: z.array(z.number().int().positive()).min(1).max(6).default([3, 6, 12]),
  /** Minimum order total for EMI, integer poisha. */
  emiMinTotalPoisha: z.number().int().min(0).default(500_000), // ৳5,000
  /** Flat EMI surcharge in basis points (100 bps = 1%). 0 = 0% EMI. */
  emiSurchargeBps: z.number().int().min(0).max(5000).default(0),
  /**
   * ADV-22 wiring: category slugs this pack's warranty terms apply to
   * (matching rule in packs.ts packCategoryMatches).
   */
  categorySlugs: z.array(z.string().min(1)).max(20).default(["electronics"]),
  /**
   * ADV-22 wiring: warranty length per category; categories without an
   * entry fall back to defaultWarrantyMonths. Warranty STARTS at
   * delivery (see electronics-warranty.ts) — never at order time.
   */
  warrantyMonthsByCategory: z
    .array(
      z.object({
        categorySlug: z.string().min(1),
        months: z.number().int().min(0).max(120),
      }),
    )
    .max(20)
    .default([]),
});

export type ElectronicsConfig = z.infer<typeof electronicsConfigSchema>;

export const electronicsPack: BusinessModulePack<ElectronicsConfig> = {
  id: "electronics",
  flagKey: "module.electronics",
  nameEn: "Electronics",
  nameBn: "ইলেকট্রনিক্স",
  description: "Warranty terms and EMI instalment plans for electronics stores.",
  defaultConfig: {
    defaultWarrantyMonths: 12,
    emiTenuresMonths: [3, 6, 12],
    emiMinTotalPoisha: 500_000,
    emiSurchargeBps: 0,
    categorySlugs: ["electronics"],
    warrantyMonthsByCategory: [],
  },
  configSchema: electronicsConfigSchema,
};

/**
 * ADV-22: warranty months for a category — the per-category entry when
 * one matches (packs.ts matching rule), else the pack default. Null
 * when the category is not an electronics-pack category at all.
 */
export function warrantyMonthsForCategory(
  config: ElectronicsConfig,
  categorySlug: string,
  matches: (configured: readonly string[], slug: string) => boolean,
): number | null {
  if (!matches(config.categorySlugs, categorySlug)) return null;
  const entry = config.warrantyMonthsByCategory.find((w) => matches([w.categorySlug], categorySlug));
  return entry ? entry.months : config.defaultWarrantyMonths;
}

export interface WarrantyInfo {
  months: number;
  /** ISO date the warranty ends (purchase date + months). */
  expiresOn: string;
  isActive: boolean;
}

export function warrantyInfo(purchaseDate: Date, months: number, now: Date): WarrantyInfo {
  const end = new Date(purchaseDate);
  end.setMonth(end.getMonth() + months);
  return { months, expiresOn: end.toISOString().slice(0, 10), isActive: now.getTime() <= end.getTime() };
}

export interface EmiPlan {
  tenureMonths: number;
  /** Financed total including surcharge, integer poisha. */
  financedTotalPoisha: number;
  surchargePoisha: number;
  /** One amount per month; sums exactly to financedTotalPoisha. */
  instalmentsPoisha: number[];
}

export function calculateEmi(totalPoisha: number, tenureMonths: number, surchargeBps: number): EmiPlan {
  if (!Number.isInteger(totalPoisha) || totalPoisha < 0) {
    throw new Error("EMI total must be a non-negative integer (poisha).");
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    throw new Error("EMI tenure must be a positive integer number of months.");
  }
  const surchargePoisha = Math.floor((totalPoisha * surchargeBps) / 10_000);
  const financedTotalPoisha = totalPoisha + surchargePoisha;
  const base = Math.floor(financedTotalPoisha / tenureMonths);
  const remainder = financedTotalPoisha - base * tenureMonths;
  const instalmentsPoisha = Array.from({ length: tenureMonths }, (_, i) =>
    i < remainder ? base + 1 : base,
  );
  return { tenureMonths, financedTotalPoisha, surchargePoisha, instalmentsPoisha };
}

export function validateEmiEligibility(
  config: ElectronicsConfig,
  input: { totalPoisha: number; tenureMonths: number },
): PackValidation {
  const errors: Array<{ field: string; message: string }> = [];
  if (input.totalPoisha < config.emiMinTotalPoisha) {
    errors.push({ field: "totalPoisha", message: "Order total is below the EMI minimum." });
  }
  if (!config.emiTenuresMonths.includes(input.tenureMonths)) {
    errors.push({ field: "tenureMonths", message: "Selected EMI tenure is not offered." });
  }
  return errors.length ? { ok: false, errors } : { ok: true };
}
