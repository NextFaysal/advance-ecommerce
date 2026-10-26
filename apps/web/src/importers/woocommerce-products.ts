// WooCommerce product CSV export -> platform import rows (ADV-25).
//
// Targets the real WooCommerce exporter column set (ID, Type, SKU,
// Name, Published, "Regular price", "Sale price", Categories, Tags,
// Stock, "In stock?", "Short description", Description, Images,
// Parent, …). Header normalisation turns "Regular price" into
// regular_price, so underscore-style exports land on the same aliases.
//
// Structure: rows of Type "variable" are product definitions; rows of
// Type "variation" are their variants, linked by the Parent column
// (parent SKU, "id:<ID>", or the parent name — all three forms occur
// in real exports). A variation whose parent cannot be resolved is
// imported as a standalone product under its own name and the report
// says so. "grouped" / "external" products are skipped with a reason:
// they are not sellable catalog products in this platform.
//
// The existing pipeline has NO variant-attribute column, so Woo
// attribute values (Attribute 1 value(s), …) cannot be carried —
// variants are distinguished by SKU/price/stock only, and the report
// states this plainly instead of pretending otherwise.

import {
  SlugAllocator,
  convertTags,
  deepestCategorySegment,
  firstImageUrl,
  normalizeStockCell,
  pick,
  slugify,
  splitColumns,
  stripHtml,
  type NormalizedTable,
} from "./common";
import { compareDecimal, resolvePriceCell, type PriceCellStats } from "./currency";
import type { MappingEntry, ProductMapResult, SkippedSourceRow } from "./types";

export const WOO_PRODUCT_MAPPING: MappingEntry[] = [
  { source: "Name", target: "title_en + title_bn", note: "Single-language source: the same name fills both language fields." },
  { source: "— (generated)", target: "slug", note: "Slugified from Name; collisions get a numeric suffix (listed in the report)." },
  { source: "Description", target: "description_en + description_bn", note: "HTML stripped to plain text. Falls back to Short description." },
  { source: "Short description", target: "description_* (fallback only)" },
  { source: "Categories", target: "category_slug", note: "Deepest segment of the first listed category path, slugified. Must already exist in the platform." },
  { source: "Brands / Brand", target: "brand_name", note: "Only when the export carries a brand column (brand plugins do; core WooCommerce does not)." },
  { source: "Published", target: "status", note: "1 = ACTIVE, anything else = DRAFT. Imports are still created as DRAFT by the pipeline." },
  { source: "Tags", target: "tags", note: "Comma-separated in Woo; converted to the platform's | separator." },
  { source: "SKU", target: "sku" },
  { source: "Sale price", target: "price_taka", note: "When a sale price is present it is the selling price…" },
  { source: "Regular price", target: "compare_at_taka", note: "…and the regular price becomes the compare-at price. Without a sale, Regular price is price_taka." },
  { source: "Stock", target: "stock", note: "Empty = not stock-managed in Woo -> 0 (counted in the report). Negative (backorders) clamped to 0 and listed." },
  { source: "Images", target: "image_url", note: "First image of the row (a variation without its own image inherits the parent's first image)." },
  { source: "Parent", target: "(grouping)", note: "Links variation rows to their variable product; never stored." },
  { source: "Type", target: "(grouping)", note: "simple / variable / variation honoured; grouped / external skipped with a reason." },
];

const CONSUMED = new Set([
  "id",
  "type",
  "sku",
  "name",
  "published",
  "short_description",
  "description",
  "regular_price",
  "sale_price",
  "categories",
  "tags",
  "stock",
  "in_stock",
  "images",
  "parent",
  "brands",
  "brand",
  "brand_name",
]);

interface ProductDef {
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  brandName: string;
  status: string;
  tags: string;
  firstImage: string;
}

export function mapWoocommerceProducts(
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

  const typeOf = (row: Record<string, string>) => pick(row, ["type"]).toLowerCase();
  const nameOf = (row: Record<string, string>) => pick(row, ["name"]);
  const skuOf = (row: Record<string, string>) => pick(row, ["sku"]);

  // Parent resolution indexes over ALL rows.
  const byId = new Map<string, number>();
  const bySku = new Map<string, number>();
  const byName = new Map<string, number>();
  rows.forEach((row, idx) => {
    const id = pick(row, ["id"]);
    if (id !== "") byId.set(id, idx);
    const sku = skuOf(row);
    if (sku !== "") bySku.set(sku, idx);
    const name = nameOf(row);
    if (name !== "") byName.set(name, idx);
  });

  function defFromRow(idx: number): ProductDef {
    const row = rows[idx] as Record<string, string>;
    const name = nameOf(row);
    const description =
      stripHtml(pick(row, ["description"])) || stripHtml(pick(row, ["short_description"]));
    const published = pick(row, ["published"]).toLowerCase();
    return {
      slug: allocator.allocate(slugify(name) || slugify(skuOf(row)) || (pick(row, ["id"]) ? `woo-product-${pick(row, ["id"])}` : "")),
      name,
      description,
      categorySlug: slugify(deepestCategorySegment(pick(row, ["categories"]))),
      brandName: pick(row, ["brands", "brand", "brand_name"]),
      status: published === "1" || published === "true" ? "ACTIVE" : "DRAFT",
      tags: convertTags(pick(row, ["tags"])),
      firstImage: firstImageUrl(pick(row, ["images"])),
    };
  }

  const defs = new Map<number, ProductDef>();
  const defFor = (idx: number): ProductDef => {
    let def = defs.get(idx);
    if (!def) {
      def = defFromRow(idx);
      defs.set(idx, def);
    }
    return def;
  };

  function variantValues(
    def: ProductDef,
    row: Record<string, string>,
  ): Record<string, string> | null {
    const sku = skuOf(row);
    const regular = resolvePriceCell(pick(row, ["regular_price"]), currency, priceStats);
    const sale = resolvePriceCell(pick(row, ["sale_price"]), currency, priceStats);
    let price = "";
    let compareAt = "";
    if (sale !== "" && regular !== "") {
      // Both present: the sale price is the selling price and the
      // regular price the compare-at — but only when the sale is
      // genuinely lower; otherwise the pair is bad data and the
      // regular price stands alone (the report's row data shows it).
      if (compareDecimal(sale, regular) === -1) {
        price = sale;
        compareAt = regular;
      } else {
        price = regular;
      }
    } else if (regular !== "") {
      price = regular;
    } else if (sale !== "") {
      price = sale;
    }
    const stock = normalizeStockCell(pick(row, ["stock"]), stockStats, sku);
    return {
      slug: def.slug,
      title_bn: def.name,
      title_en: def.name,
      description_bn: def.description,
      description_en: def.description,
      category_slug: def.categorySlug,
      brand_name: def.brandName,
      status: def.status,
      tags: def.tags,
      sku,
      price_taka: price,
      compare_at_taka: compareAt,
      cost_taka: "",
      stock,
      image_url: firstImageUrl(pick(row, ["images"])) || def.firstImage,
    };
  }

  const mapped: ProductMapResult["rows"] = [];
  let standaloneVariations = 0;

  rows.forEach((row, idx) => {
    const type = typeOf(row);
    const sourceRow = sourceRowOf(idx);
    const ref = skuOf(row) || nameOf(row) || `row ${sourceRow}`;

    if (type === "grouped" || type === "external") {
      skipped.push({
        sourceRow,
        sourceRef: ref,
        reason: `Type "${type}" is not a sellable catalog product in this platform — skipped, not guessed.`,
      });
      return;
    }

    if (type === "variation") {
      const parentCell = pick(row, ["parent"]);
      let parentIdx: number | undefined;
      if (parentCell.toLowerCase().startsWith("id:")) {
        parentIdx = byId.get(parentCell.slice(3).trim());
      }
      if (parentIdx === undefined && parentCell !== "") parentIdx = bySku.get(parentCell);
      if (parentIdx === undefined && parentCell !== "") parentIdx = byName.get(parentCell);
      if (skuOf(row) === "") {
        skipped.push({
          sourceRow,
          sourceRef: ref,
          reason: "Variation row has no SKU — the platform requires a SKU per variant.",
        });
        return;
      }
      const def = parentIdx !== undefined ? defFor(parentIdx) : defFor(idx);
      if (parentIdx === undefined) standaloneVariations += 1;
      const values = variantValues(def, row);
      if (values) mapped.push({ sourceRow, sourceRef: ref, values });
      return;
    }

    if (type === "variable") {
      // The parent defines the product. It becomes a variant itself
      // only when it carries its own SKU + price (some exports do).
      defFor(idx);
      if (skuOf(row) !== "" && (pick(row, ["regular_price"]) !== "" || pick(row, ["sale_price"]) !== "")) {
        const values = variantValues(defFor(idx), row);
        if (values) mapped.push({ sourceRow, sourceRef: ref, values });
      }
      return;
    }

    // simple (or untyped) product rows.
    if (nameOf(row) === "") {
      skipped.push({ sourceRow, sourceRef: ref, reason: "Row has no Name — nothing provable to import." });
      return;
    }
    if (skuOf(row) === "") {
      skipped.push({
        sourceRow,
        sourceRef: ref,
        reason: "Product row has no SKU — the platform requires a SKU per variant.",
      });
      return;
    }
    const values = variantValues(defFor(idx), row);
    if (values) mapped.push({ sourceRow, sourceRef: ref, values });
  });

  if (standaloneVariations > 0) {
    notes.push(
      `${standaloneVariations} variation row(s) could not be linked to a parent product via the Parent column and were imported as standalone products under their own names.`,
    );
  }
  if (allocator.adjusted.length > 0) {
    notes.push(
      `Slug collisions adjusted for uniqueness: ${allocator.adjusted.map((a) => `${a.base} -> ${a.slug}`).join(", ")}.`,
    );
  }
  if (stockStats.unmanaged > 0) {
    notes.push(
      `${stockStats.unmanaged} row(s) had no stock value in WooCommerce (stock not managed there) and were imported with stock 0.`,
    );
  }
  if (stockStats.clampedSkus.length > 0) {
    notes.push(
      `Negative stock (WooCommerce backorder allowance) clamped to 0 for SKU(s): ${stockStats.clampedSkus.join(", ")}.`,
    );
  }
  if (priceStats.failedCells > 0) {
    notes.push(
      `${priceStats.failedCells} price cell(s) could not be converted with the supplied rate and were left empty — those rows are reported invalid (price required).`,
    );
  }
  notes.push(
    "WooCommerce variant attributes (Attribute 1/2 value(s)) are NOT carried: the existing import pipeline has no attribute column, so variants are distinguished by SKU, price and stock only.",
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
