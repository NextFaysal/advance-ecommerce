// Product-import dry run (ADV-25): source CSV -> source mapper ->
// the EXISTING catalog pipeline (previewImportRows) -> a report in
// SOURCE row numbers. Nothing is persisted here. Confirmation is the
// existing POST /api/v1/admin/products/import/confirm endpoint fed
// with this report's platformCsv, so create semantics (DRAFT-only,
// per-row outcomes, audit) are literally the native import's.

import { prisma } from "@advance-ecommerce/db";
import { parseCsv, previewImportRows } from "@/catalog/import";
import { getCatalogRepository } from "@/catalog/api";
import { buildCsv, normalizeTable } from "./common";
import { parseDecimal } from "./currency";
import { DARAZ_PRODUCT_MAPPING, mapDarazProducts } from "./daraz-products";
import { SHOPIFY_PRODUCT_MAPPING, mapShopifyProducts } from "./shopify-products";
import { WOO_PRODUCT_MAPPING, mapWoocommerceProducts } from "./woocommerce-products";
import type {
  CategoryWarning,
  CurrencyOptions,
  ImportRefusal,
  InvalidReportRow,
  MappingEntry,
  ProductImportReport,
  ProductMapResult,
  ProductSourceId,
} from "./types";

/** The platform's native import headers, in template order. Mappers
 *  emit taka columns (source prices are major-unit decimals). */
export const PLATFORM_CSV_HEADERS = [
  "slug",
  "title_bn",
  "title_en",
  "description_bn",
  "description_en",
  "category_slug",
  "brand_name",
  "status",
  "tags",
  "sku",
  "price_taka",
  "compare_at_taka",
  "cost_taka",
  "stock",
  "image_url",
];

export const PRODUCT_MAPPINGS: Record<ProductSourceId, MappingEntry[]> = {
  woocommerce: WOO_PRODUCT_MAPPING,
  shopify: SHOPIFY_PRODUCT_MAPPING,
  daraz: DARAZ_PRODUCT_MAPPING,
};

const MAPPERS: Record<
  ProductSourceId,
  (table: ReturnType<typeof normalizeTable>, currency: { source: string; rate: string | null }) => ProductMapResult
> = {
  woocommerce: mapWoocommerceProducts,
  shopify: mapShopifyProducts,
  daraz: mapDarazProducts,
};

export async function dryRunProductImport(input: {
  source: ProductSourceId;
  csvText: string;
  fileName?: string | null;
  currency?: CurrencyOptions;
}): Promise<ProductImportReport | ImportRefusal> {
  const sourceCurrency = (input.currency?.sourceCurrency ?? "BDT").trim().toUpperCase() || "BDT";
  const rateRaw = (input.currency?.exchangeRateToBdt ?? "").trim();
  if (sourceCurrency !== "BDT") {
    const rate = rateRaw === "" ? null : parseDecimal(rateRaw);
    if (!rate || rate.digits <= 0n) {
      return {
        refused: true,
        code: "NON_BDT_RATE_REQUIRED",
        message:
          `The file's prices are declared as ${sourceCurrency}, not BDT. ` +
          "Refusing to import: supply an explicit exchange rate (BDT per 1 " +
          `${sourceCurrency}) so every price is converted at a recorded rate, or export the file in BDT.`,
      };
    }
  }
  const currency = {
    source: sourceCurrency,
    rate: sourceCurrency === "BDT" ? null : rateRaw,
  };

  const table = parseCsv(input.csvText);
  const normalized = normalizeTable(table);
  const mapped = MAPPERS[input.source](normalized, currency);

  const mappedValues = mapped.rows.map((r) => r.values);
  const fileSkus = [
    ...new Set(mappedValues.map((r) => (r.sku ?? "").trim()).filter((s) => s !== "")),
  ];

  const repo = await getCatalogRepository();
  const existingSkus = new Set(await repo.skusExist(fileSkus));
  const preview = previewImportRows([...PLATFORM_CSV_HEADERS], mappedValues, existingSkus);

  // Translate pipeline invalids (mapped-file row numbers) back to
  // source rows via the parallel mapping array.
  const invalidRows: InvalidReportRow[] = [];
  for (const invalid of preview.invalidRows) {
    const origin = mapped.rows[invalid.row - 2];
    for (const error of invalid.errors) {
      invalidRows.push({
        sourceRow: origin?.sourceRow ?? invalid.row,
        sourceRef: origin?.sourceRef ?? "",
        field: error.field,
        message: error.message,
      });
    }
  }

  // Category warnings: a mapped product whose category slug is not a
  // live platform category WILL fail at confirm (create throws
  // "Category not found") — say so now, while it can still be fixed.
  const categoryWarnings: CategoryWarning[] = [];
  const categories = await prisma.category.findMany({
    where: { deletedAt: null },
    select: { slug: true },
  });
  const liveCategorySlugs = new Set(categories.map((c) => c.slug));
  const seenCategoryPair = new Set<string>();
  for (const row of mapped.rows) {
    const categorySlug = row.values.category_slug ?? "";
    if (categorySlug === "" || liveCategorySlugs.has(categorySlug)) continue;
    const pair = `${row.values.slug}::${categorySlug}`;
    if (seenCategoryPair.has(pair)) continue;
    seenCategoryPair.add(pair);
    categoryWarnings.push({
      slug: row.values.slug ?? "",
      categorySlug,
      message:
        `Category "${categorySlug}" does not exist in this store — product "${row.values.slug}" ` +
        "will fail at confirm until the category is created (or the source category is changed).",
    });
  }

  const notes = [...mapped.notes];
  if (currency.source !== "BDT") {
    notes.push(
      `Prices were converted from ${currency.source} to BDT at the admin-supplied rate 1 ${currency.source} = ${currency.rate} BDT. The rate is recorded here and in the audit trail; source prices were not used directly.`,
    );
  }
  if (table.rows.length === 0) {
    notes.push("The file contains no data rows.");
  }

  return {
    source: input.source,
    kind: "products",
    fileName: input.fileName ?? null,
    templateBased: input.source === "daraz",
    currency: {
      source: currency.source,
      exchangeRateToBdt: currency.rate,
      converted: currency.source !== "BDT",
    },
    totalSourceRows: table.rows.length,
    mappedRowCount: mapped.rows.length,
    productCount: mapped.productCount,
    validCount: preview.validRows.length,
    invalidCount: preview.invalidRows.length,
    invalidRows,
    skippedSourceRows: mapped.skipped,
    unmappedColumns: mapped.unmappedColumns,
    consumedColumns: mapped.consumedColumns,
    categoryWarnings,
    notes,
    mapping: PRODUCT_MAPPINGS[input.source],
    platformCsv: buildCsv([...PLATFORM_CSV_HEADERS], mappedValues),
    errorReportCsv: preview.errorReportCsv,
  };
}

export function isRefusal<T extends object>(result: T | ImportRefusal): result is ImportRefusal {
  return (result as ImportRefusal).refused === true;
}
