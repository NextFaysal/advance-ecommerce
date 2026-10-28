/**
 * Fashion pack — Agent 17, Step 49 (Part C).
 * Size chart + size-guide rendering + size validation for apparel.
 * Pure config/logic; the chart is merchant data stored with the pack config.
 *
 * Schema-free (perf wave, zod diet): the zod config schema and the
 * fashionPack registry object live in ./fashion-server (server only),
 * so client components (the PDP size guide) can import the pure
 * helpers + default config here without bundling zod. The
 * FashionConfig type is the server schema's inferred type, imported
 * type-only.
 */
import type { PackValidation } from "./types";
import type { FashionConfig } from "./fashion-server";

export type { FashionConfig } from "./fashion-server";

export interface SizeChartRow {
  size: string; // "M", "L", "38", "42" ...
  /** Measurements in centimetres. */
  chestCm?: number;
  waistCm?: number;
  lengthCm?: number;
  footCm?: number;
}

/** Built-in default pack config (merchant data, editable per store). */
export const FASHION_DEFAULT_CONFIG: FashionConfig = {
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
