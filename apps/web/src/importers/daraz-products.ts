// Daraz seller-center product template -> platform import rows
// (ADV-25). TEMPLATE-BASED: the real Daraz mass-upload template could
// not be verified against a live seller-center export from this
// codebase, so this mapper targets the commonly documented Daraz
// template fields (Product Name, Brand, Description, Category,
// Seller SKU, Price, Sale Price, Quantity, Image URL) with generous
// aliases. The admin UI and every report label this importer
// "template-based — verify against a real export". Products only:
// no Daraz order import is offered, because no order-export format
// could be verified at all.

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

export const DARAZ_PRODUCT_MAPPING: MappingEntry[] = [
  { source: "Product Name", target: "title_en + title_bn", note: "Single-language source: the same name fills both language fields." },
  { source: "— (generated)", target: "slug", note: "Slugified from Product Name; collisions get a numeric suffix (listed in the report)." },
  { source: "Description", target: "description_en + description_bn", note: "HTML stripped when present." },
  { source: "Category", target: "category_slug", note: "Deepest segment, slugified. Daraz category IDs (numeric) will not match a platform category — the dry-run warns per product." },
  { source: "Brand", target: "brand_name" },
  { source: "Seller SKU", target: "sku" },
  { source: "Price", target: "price_taka", note: "When a lower Sale Price is present it becomes the selling price and Price becomes compare_at_taka." },
  { source: "Sale Price", target: "price_taka (when lower than Price)" },
  { source: "Quantity", target: "stock", note: "Empty -> 0 (counted in the report). Negative clamped to 0 and listed." },
  { source: "Image URL", target: "image_url", note: "First image when the cell carries several." },
  { source: "Tags", target: "tags", note: "Only when the template carries a tags column." },
];

const NAME_KEYS = ["product_name", "name", "title", "product_title"];
const BRAND_KEYS = ["brand", "brand_name"];
const DESC_KEYS = ["description", "product_description", "short_description", "highlights", "product_details"];
const CATEGORY_KEYS = ["category", "category_name", "primary_category", "category_id"];
const SKU_KEYS = ["seller_sku", "sku", "seller_sku_code", "item_sku"];
const PRICE_KEYS = ["price", "retail_price", "mrp"];
const SALE_KEYS = ["sale_price", "special_price", "discount_price", "saleprice", "special_from_date_price"];
const STOCK_KEYS = ["quantity", "stock", "qty", "available_quantity", "inventory"];
const IMAGE_KEYS = ["image_url", "image", "main_image", "product_image", "image_link", "image_1", "images"];
const TAG_KEYS = ["tags", "tag"];

const CONSUMED = new Set([
  ...NAME_KEYS,
  ...BRAND_KEYS,
  ...DESC_KEYS,
  ...CATEGORY_KEYS,
  ...SKU_KEYS,
  ...PRICE_KEYS,
  ...SALE_KEYS,
  ...STOCK_KEYS,
  ...IMAGE_KEYS,
  ...TAG_KEYS,
]);

export function mapDarazProducts(
  table: NormalizedTable,
  currency: { source: string; rate: string | null },
): ProductMapResult {
  const skipped: SkippedSourceRow[] = [];
  const notes: string[] = [
    "TEMPLATE-BASED importer: the column mapping targets the commonly documented Daraz seller-center template and has NOT been verified against a real export from your seller center. Check the dry-run mapping table before confirming.",
  ];
  const allocator = new SlugAllocator();
  const priceStats: PriceCellStats = { convertedCells: 0, failedCells: 0 };
  const stockStats = { unmanaged: 0, clampedSkus: [] as string[] };

  const mapped: ProductMapResult["rows"] = [];
  table.rows.forEach((row, idx) => {
    const sourceRow = idx + 2;
    const name = pick(row, NAME_KEYS);
    const sku = pick(row, SKU_KEYS);
    const ref = sku || name || `row ${sourceRow}`;
    if (name === "") {
      skipped.push({ sourceRow, sourceRef: ref, reason: "Row has no product name — nothing provable to import." });
      return;
    }
    if (sku === "") {
      skipped.push({
        sourceRow,
        sourceRef: ref,
        reason: "Row has no Seller SKU — the platform requires a SKU per variant.",
      });
      return;
    }
    const priceRegular = resolvePriceCell(pick(row, PRICE_KEYS), currency, priceStats);
    const priceSale = resolvePriceCell(pick(row, SALE_KEYS), currency, priceStats);
    let price = priceRegular;
    let compareAt = "";
    if (priceSale !== "" && priceRegular !== "" && compareDecimal(priceSale, priceRegular) === -1) {
      price = priceSale;
      compareAt = priceRegular;
    } else if (priceRegular === "" && priceSale !== "") {
      price = priceSale;
    }
    mapped.push({
      sourceRow,
      sourceRef: ref,
      values: {
        slug: allocator.allocate(slugify(name) || slugify(sku)),
        title_bn: name,
        title_en: name,
        description_bn: stripHtml(pick(row, DESC_KEYS)),
        description_en: stripHtml(pick(row, DESC_KEYS)),
        category_slug: slugify(deepestCategorySegment(pick(row, CATEGORY_KEYS))),
        brand_name: pick(row, BRAND_KEYS),
        // The Daraz template carries no publish flag the mapper can
        // prove — everything enters as DRAFT (the pipeline forces
        // DRAFT on create anyway).
        status: "DRAFT",
        tags: convertTags(pick(row, TAG_KEYS)),
        sku,
        price_taka: price,
        compare_at_taka: compareAt,
        cost_taka: "",
        stock: normalizeStockCell(pick(row, STOCK_KEYS), stockStats, sku),
        image_url: firstImageUrl(pick(row, IMAGE_KEYS)),
      },
    });
  });

  if (allocator.adjusted.length > 0) {
    notes.push(
      `Slug collisions adjusted for uniqueness: ${allocator.adjusted.map((a) => `${a.base} -> ${a.slug}`).join(", ")}.`,
    );
  }
  if (stockStats.unmanaged > 0) {
    notes.push(`${stockStats.unmanaged} row(s) had no quantity in the template and were imported with stock 0.`);
  }
  if (stockStats.clampedSkus.length > 0) {
    notes.push(`Negative quantity clamped to 0 for SKU(s): ${stockStats.clampedSkus.join(", ")}.`);
  }
  if (priceStats.failedCells > 0) {
    notes.push(
      `${priceStats.failedCells} price cell(s) could not be converted with the supplied rate and were left empty — those rows are reported invalid (price required).`,
    );
  }

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
