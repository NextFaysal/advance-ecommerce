/**
 * Fashion pack — Agent 17, Step 49 (Part C).
 * Size chart + size-guide rendering + size validation for apparel.
 * Pure config/logic; the chart is merchant data stored with the pack config.
 */
import { z } from "zod";
import type { BusinessModulePack, PackValidation } from "./types";

export interface SizeChartRow {
  size: string; // "M", "L", "38", "42" ...
  /** Measurements in centimetres. */
  chestCm?: number;
  waistCm?: number;
  lengthCm?: number;
  footCm?: number;
}

const sizeChartRowSchema = z.object({
  size: z.string().min(1),
  chestCm: z.number().positive().optional(),
  waistCm: z.number().positive().optional(),
  lengthCm: z.number().positive().optional(),
  footCm: z.number().positive().optional(),
});

export const fashionConfigSchema = z.object({
  /** Size labels offered on apparel products, in display order. */
  sizes: z.array(z.string().min(1)).min(1).max(30),
  sizeChart: z.array(sizeChartRowSchema),
  /** Show the "how to measure" guide block on product pages. */
  showMeasureGuide: z.boolean().default(true),
  /** Allow a free-text fit note from the customer at checkout. */
  allowFitNote: z.boolean().default(false),
  /**
   * ADV-22 wiring: category slugs this pack's size chart applies to
   * (matching rule in packs.ts packCategoryMatches). A product's OWN
   * sizeChart (Product.sizeChart) always wins on the PDP; the pack
   * chart is the fallback for products in these categories.
   */
  categorySlugs: z.array(z.string().min(1)).max(20).default(["fashion"]),
  /** Default fit note shown with the pack chart (e.g. "true to size"). */
  fitNoteBn: z.string().max(200).optional(),
  fitNoteEn: z.string().max(200).optional(),
  /**
   * Per-category chart overrides: a category entry replaces the
   * default chart + fit note for products in that category.
   */
  categoryCharts: z
    .array(
      z.object({
        categorySlug: z.string().min(1),
        sizeChart: z.array(sizeChartRowSchema).min(1),
        fitNoteBn: z.string().max(200).optional(),
        fitNoteEn: z.string().max(200).optional(),
      }),
    )
    .max(20)
    .default([]),
});

export type FashionConfig = z.infer<typeof fashionConfigSchema>;

export const fashionPack: BusinessModulePack<FashionConfig> = {
  id: "fashion",
  flagKey: "module.fashion",
  nameEn: "Fashion",
  nameBn: "ফ্যাশন",
  description: "Size charts, size guide and fit notes for apparel stores.",
  defaultConfig: {
    sizes: ["S", "M", "L", "XL", "XXL"],
    sizeChart: [
      { size: "S", chestCm: 96, lengthCm: 66 },
      { size: "M", chestCm: 101, lengthCm: 69 },
      { size: "L", chestCm: 106, lengthCm: 71 },
      { size: "XL", chestCm: 112, lengthCm: 74 },
      { size: "XXL", chestCm: 117, lengthCm: 76 },
    ],
    showMeasureGuide: true,
    allowFitNote: false,
    categorySlugs: ["fashion"],
    fitNoteBn: "সাইজ স্বাভাবিক — আপনার নিয়মিত সাইজটাই নিন।",
    fitNoteEn: "True to size — order your usual size.",
    categoryCharts: [],
  },
  configSchema: fashionConfigSchema,
};

/** A chosen size is valid only when it is one of the pack's sizes. */
export function validateFashionSelection(
  config: FashionConfig,
  selection: { size: string },
): PackValidation {
  if (!config.sizes.includes(selection.size)) {
    return { ok: false, errors: [{ field: "size", message: "Selected size is not available." }] };
  }
  return { ok: true };
}

export interface SizeGuideRow {
  size: string;
  measurements: Array<{ label: string; cm: number }>;
}

/** Render-ready size guide rows (bn/en labels chosen by the caller). */
export function buildSizeGuide(config: FashionConfig): SizeGuideRow[] {
  return config.sizeChart.map((row) => {
    const measurements: Array<{ label: string; cm: number }> = [];
    if (row.chestCm !== undefined) measurements.push({ label: "chest", cm: row.chestCm });
    if (row.waistCm !== undefined) measurements.push({ label: "waist", cm: row.waistCm });
    if (row.lengthCm !== undefined) measurements.push({ label: "length", cm: row.lengthCm });
    if (row.footCm !== undefined) measurements.push({ label: "foot", cm: row.footCm });
    return { size: row.size, measurements };
  });
}

/** Nearest chart size for a body measurement (cm) — guide helper, never auto-selects. */
export function suggestSize(config: FashionConfig, chestCm: number): string | null {
  let best: SizeChartRow | null = null;
  for (const row of config.sizeChart) {
    if (row.chestCm === undefined) continue;
    if (row.chestCm >= chestCm && (best === null || (best.chestCm ?? Infinity) > row.chestCm)) {
      best = row;
    }
  }
  return best?.size ?? null;
}

export interface ResolvedFashionChart {
  rows: SizeChartRow[];
  fitNoteBn: string | null;
  fitNoteEn: string | null;
  /** "category" = per-category override; "default" = the pack's base chart. */
  source: "category" | "default";
}

/**
 * ADV-22: resolve the pack size chart for a product category. A
 * categoryCharts entry whose slug matches (packs.ts matching rule)
 * wins; otherwise, when the category belongs to the pack at all, the
 * pack's default chart + fit note apply. Null = the pack has no chart
 * for this category (the PDP then shows no pack chart).
 */
export function resolveFashionChart(
  config: FashionConfig,
  categorySlug: string,
  matches: (configured: readonly string[], slug: string) => boolean,
): ResolvedFashionChart | null {
  const entry = config.categoryCharts.find((c) => matches([c.categorySlug], categorySlug));
  if (entry) {
    return {
      rows: entry.sizeChart,
      fitNoteBn: entry.fitNoteBn ?? config.fitNoteBn ?? null,
      fitNoteEn: entry.fitNoteEn ?? config.fitNoteEn ?? null,
      source: "category",
    };
  }
  if (!matches(config.categorySlugs, categorySlug)) return null;
  if (config.sizeChart.length === 0) return null;
  return {
    rows: config.sizeChart,
    fitNoteBn: config.fitNoteBn ?? null,
    fitNoteEn: config.fitNoteEn ?? null,
    source: "default",
  };
}
