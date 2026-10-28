// Fashion pack validation schemas + pack object — SERVER ONLY
// (perf wave, zod diet).
//
// The fashionConfigSchema and the fashionPack registry object (which
// carries the schema as its configSchema) used to live in ./fashion
// next to the shared size-chart types + pure helpers. The PDP size
// guide (src/storefront-ux/size-guide.ts, a client path) imports
// those helpers and the pack's default config, which dragged the
// zod runtime into the browser bundle. The schemas + pack now live
// here; ./fashion stays schema-free (it holds FASHION_DEFAULT_CONFIG
// and the pure chart helpers) so client components can import it
// safely.
//
// Server validation is unchanged: the pack registry (./packs)
// imports the exact same pack object from this module instead.
import { z } from "zod";
import type { BusinessModulePack } from "./types";
import { FASHION_DEFAULT_CONFIG } from "./fashion";

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
  defaultConfig: FASHION_DEFAULT_CONFIG,
  configSchema: fashionConfigSchema,
};
