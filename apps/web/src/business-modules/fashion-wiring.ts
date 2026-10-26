/**
 * Fashion size-chart PDP wiring — ADV-22 (doc 22).
 *
 * The PDP already renders a size chart when the PRODUCT carries one
 * (Product.sizeChart → SizeChartButton/SizeChartSection). This module
 * is the fallback: when the product has no chart of its own and the
 * fashion pack is enabled, resolve the pack chart for the product's
 * category (per-category override, else the pack default) and convert
 * it into the same {headers, rows} table shape the PDP components
 * render, plus the pack's fit note for the category.
 */
import { buildSizeGuide, resolveFashionChart, type FashionConfig } from "./fashion";
import { packCategoryMatches } from "./packs";
import { getEnabledPackConfig } from "./config-store";
import type { SizeChart } from "@/catalog/types";

export interface PdpPackSizeChart {
  table: SizeChart;
  fitNoteBn: string | null;
  fitNoteEn: string | null;
  source: "category" | "default";
}

const MEASUREMENT_HEADERS: Record<string, { bn: string; en: string }> = {
  chest: { bn: "বুক (সে.মি.)", en: "Chest (cm)" },
  waist: { bn: "কোমর (সে.মি.)", en: "Waist (cm)" },
  length: { bn: "লম্বা (সে.মি.)", en: "Length (cm)" },
  foot: { bn: "পা (সে.মি.)", en: "Foot (cm)" },
};

/**
 * The pack chart for a category, or null (pack off, or the category
 * is not a fashion-pack category). Server-side only (reads the saved
 * config doc); the PDP calls it during render.
 */
export async function resolvePdpPackSizeChart(categorySlug: string): Promise<PdpPackSizeChart | null> {
  const config = await getEnabledPackConfig<FashionConfig>("fashion");
  if (!config) return null;
  const resolved = resolveFashionChart(config, categorySlug, packCategoryMatches);
  if (!resolved) return null;
  const guideRows = buildSizeGuide({ ...config, sizeChart: resolved.rows });
  if (guideRows.length === 0) return null;
  // Columns = the measurement kinds present in ANY row, in guide order.
  const labels: string[] = [];
  for (const row of guideRows) {
    for (const m of row.measurements) {
      if (!labels.includes(m.label)) labels.push(m.label);
    }
  }
  const headers = [
    "সাইজ / Size",
    ...labels.map((l) => {
      const h = MEASUREMENT_HEADERS[l];
      return h ? `${h.bn} / ${h.en}` : l;
    }),
  ];
  const rows = guideRows.map((row) => {
    const byLabel = new Map(row.measurements.map((m) => [m.label, m.cm]));
    return [row.size, ...labels.map((l) => (byLabel.has(l) ? String(byLabel.get(l)) : "—"))];
  });
  return {
    table: { headers, rows },
    fitNoteBn: resolved.fitNoteBn,
    fitNoteEn: resolved.fitNoteEn,
    source: resolved.source,
  };
}
