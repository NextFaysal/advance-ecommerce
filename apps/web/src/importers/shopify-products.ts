// Shopify product CSV export -> platform import rows (ADV-25).
//
// Shopify exports one row per VARIANT, grouped by Handle; the first
// row of a handle carries Title / Body (HTML) / Vendor / Tags, later
// rows leave them empty, and image-only rows carry just Handle +
// Image Src. This mapper regroups by Handle, takes the product-level
// fields from the definition row, and emits one pipeline row per
// variant row.
//
// Like WooCommerce, variant options (Option1 Value, …) cannot be
// carried — the existing pipeline has no attribute column — and the
// report says so. Gift Card products are skipped with a reason: they
// are not catalog products in this platform.

import {
  SlugAllocator,
  convertTags,
  deepestCategorySegment,
  normalizeStockCell,
  pick,
  slugify,
  splitColumns,
  stripHtml,
  type NormalizedTable,
} from "./common";
import { compareDecimal, resolvePriceCell, type PriceCellStats } from "./currency";
import type { MappingEntry, ProductMapResult, SkippedSourceRow } from "./types";

export const SHOPIFY_PRODUCT_MAPPING: MappingEntry[] = [
  { source: "Handle", target: "slug", note: "Shopify handles are already slug-form; sanitised to the platform slug shape." },
  { source: "Title", target: "title_en + title_bn", note: "Single-language source: the same title fills both language fields." },
  { source: "Body (HTML)", target: "description_en + description_bn", note: "HTML stripped to plain text. Falls back to SEO Description." },
  { source: "SEO Description", target: "description_* (fallback only)" },
  { source: "Product Category", target: "category_slug", note: "Deepest segment of the taxonomy path, slugified. Falls back to Type. Must already exist in the platform." },
  { source: "Type", target: "category_slug (fallback only)" },
  { source: "Vendor", target: "brand_name" },
  { source: "Published / Status", target: "status", note: "Status column wins when present. Imports are still created as DRAFT by the pipeline." },
  { source: "Tags", target: "tags", note: "Comma-separated in Shopify; converted to the platform's | separator." },
  { source: "Variant SKU", target: "sku" },
  { source: "Variant Price", target: "price_taka" },
  { source: "Variant Compare At Price", target: "compare_at_taka", note: "Only when genuinely higher than the variant price." },
  { source: "Cost per item", target: "cost_taka" },
  { source: "Variant Inventory Qty", target: "stock", note: "Empty = not tracked in Shopify -> 0 (counted in the report). Negative (overselling allowed) clamped to 0 and listed." },
  { source: "Variant Image / Image Src", target: "image_url", note: "The variant's own image, else the handle's first Image Src." },
  { source: "Gift Card = TRUE", target: "(skipped)", note: "Gift-card products are not catalog products here — skipped with a reason." },
];

const CONSUMED = new Set([
  "handle",
  "title",
  "body_html",
  "vendor",
  "product_category",
  "type",
  "tags",
  "published",
  "status",
  "variant_sku",
  "variant_price",
  "variant_compare_at_price",
  "variant_inventory_qty",
  "variant_inventory_tracker",
  "variant_image",
  "image_src",
  "gift_card",
  "seo_description",
  "cost_per_item",
]);

interface HandleGroup {
  handle: string;
  firstRowIdx: number;
  rowIdxs: number[];
}

export function mapShopifyProducts(
  table: NormalizedTable,
  currency: { source: string; rate: string | null },
): ProductMapResult {
  const skipped: SkippedSourceRow[] = [];
  const notes: string[] = [];
  const allocator = new SlugAllocator();
  const priceStats: PriceCellStats = { convertedCells: 0, failedCells: 0 };
  const stockStats = { unmanaged: 0, clampedSkus: [] as string[] };
  const rows = table.rows;
  const sourceRowOf = (idx: number) => idx + 2;

  const groups = new Map<string, HandleGroup>();
  rows.forEach((row, idx) => {
    const handle = pick(row, ["handle"]);
    const key = handle !== "" ? handle : `__row_${idx}`;
    let group = groups.get(key);
    if (!group) {
      group = { handle, firstRowIdx: idx, rowIdxs: [] };
      groups.set(key, group);
    }
    group.rowIdxs.push(idx);
  });

  const mapped: ProductMapResult["rows"] = [];

  for (const group of groups.values()) {
    const groupRows = group.rowIdxs.map((i) => rows[i] as Record<string, string>);
    const firstRow = sourceRowOf(group.firstRowIdx);
    const ref = group.handle || `row ${firstRow}`;
    const defRow = groupRows.find((r) => pick(r, ["title"]) !== "") ?? groupRows[0];

    if ((pick(defRow as Record<string, string>, ["gift_card"]).toLowerCase() === "true")) {
      skipped.push({
        sourceRow: firstRow,
        sourceRef: ref,
        reason: "Shopify gift-card product — not a catalog product in this platform.",
      });
      continue;
    }

    const title = pick(defRow as Record<string, string>, ["title"]);
    if (title === "") {
      skipped.push({
        sourceRow: firstRow,
        sourceRef: ref,
        reason: "No Title on any row of this handle — nothing provable to import.",
      });
      continue;
    }

    const description =
      stripHtml(pick(defRow as Record<string, string>, ["body_html"])) ||
      pick(defRow as Record<string, string>, ["seo_description"]);
    const categorySlug =
      slugify(deepestCategorySegment(pick(defRow as Record<string, string>, ["product_category"]))) ||
      slugify(pick(defRow as Record<string, string>, ["type"]));
    const statusCell = pick(defRow as Record<string, string>, ["status"]).toLowerCase();
    const status =
      statusCell === "active"
        ? "ACTIVE"
        : statusCell === "archived"
          ? "ARCHIVED"
          : statusCell === "draft"
            ? "DRAFT"
            : pick(defRow as Record<string, string>, ["published"]).toLowerCase() === "true"
              ? "ACTIVE"
              : "DRAFT";
    const slug = allocator.allocate(slugify(group.handle) || slugify(title));
    const brandName = pick(defRow as Record<string, string>, ["vendor"]);
    const tags = convertTags(pick(defRow as Record<string, string>, ["tags"]));
    const productImages = groupRows
      .map((r) => pick(r, ["image_src"]))
      .filter((u) => u !== "");

    let variantRowCount = 0;
    group.rowIdxs.forEach((idx) => {
      const row = rows[idx] as Record<string, string>;
      const isVariantRow = pick(row, ["variant_price"]) !== "" || pick(row, ["variant_sku"]) !== "";
      if (!isVariantRow) return; // image-only / definition-only row
      variantRowCount += 1;
      const sku = pick(row, ["variant_sku"]);
      const sourceRow = sourceRowOf(idx);
      if (sku === "") {
        skipped.push({
          sourceRow,
          sourceRef: ref,
          reason: "Variant row has no Variant SKU — the platform requires a SKU per variant.",
        });
        return;
      }
      const price = resolvePriceCell(pick(row, ["variant_price"]), currency, priceStats);
      const compareRaw = resolvePriceCell(
        pick(row, ["variant_compare_at_price"]),
        currency,
        priceStats,
      );
      const compareAt =
        compareRaw !== "" && price !== "" && compareDecimal(compareRaw, price) === 1
          ? compareRaw
          : "";
      mapped.push({
        sourceRow,
        sourceRef: sku,
        values: {
          slug,
          title_bn: title,
          title_en: title,
          description_bn: description,
          description_en: description,
          category_slug: categorySlug,
          brand_name: brandName,
          status,
          tags,
          sku,
          price_taka: price,
          compare_at_taka: compareAt,
          cost_taka: resolvePriceCell(pick(row, ["cost_per_item"]), currency, priceStats),
          stock: normalizeStockCell(pick(row, ["variant_inventory_qty"]), stockStats, sku),
          image_url:
            pick(row, ["variant_image"]) || pick(row, ["image_src"]) || productImages[0] || "",
        },
      });
    });

    if (variantRowCount === 0) {
      skipped.push({
        sourceRow: firstRow,
        sourceRef: ref,
        reason: "Handle has no variant rows (no Variant Price / Variant SKU) — nothing sellable to import.",
      });
    }
  }

  if (allocator.adjusted.length > 0) {
    notes.push(
      `Slug collisions adjusted for uniqueness: ${allocator.adjusted.map((a) => `${a.base} -> ${a.slug}`).join(", ")}.`,
    );
  }
  if (stockStats.unmanaged > 0) {
    notes.push(
      `${stockStats.unmanaged} variant row(s) had no inventory quantity in Shopify (untracked there) and were imported with stock 0.`,
    );
  }
  if (stockStats.clampedSkus.length > 0) {
    notes.push(
      `Negative inventory quantity (Shopify overselling) clamped to 0 for SKU(s): ${stockStats.clampedSkus.join(", ")}.`,
    );
  }
  if (priceStats.failedCells > 0) {
    notes.push(
      `${priceStats.failedCells} price cell(s) could not be converted with the supplied rate and were left empty — those rows are reported invalid (price required).`,
    );
  }
  notes.push(
    "Shopify variant options (Option1/2/3 Name + Value) are NOT carried: the existing import pipeline has no attribute column, so variants are distinguished by SKU, price and stock only.",
  );

  const { consumedColumns, unmappedColumns } = splitColumns(table.originalHeaders, CONSUMED);
  return {
    rows: mapped,
    skipped,
    unmappedColumns,
    consumedColumns,
    notes,
    productCount: new Set(mapped.map((r) => r.values.slug)).size,
  };
}
