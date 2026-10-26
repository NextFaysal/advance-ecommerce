// ADV-25 (doc 22) — external-source importers: shared types.
//
// Honesty contract for every importer in this folder:
//  - A source field is mapped ONLY when its meaning is provable from
//    the export itself. Everything else is listed as unmapped in the
//    report — never guessed into platform data.
//  - A source row that cannot be mapped is SKIPPED with a recorded
//    reason; a mapped row that fails platform validation is reported
//    invalid with the pipeline's own message. Nothing is dropped
//    silently, ever.
//  - Money stays a decimal string in the SOURCE currency's major unit
//    through the mappers; the existing catalog pipeline converts
//    taka -> poisha with its own exact math. A non-BDT source is
//    converted ONLY when the admin supplied an explicit rate, and the
//    rate is recorded in the report.

export type ProductSourceId = "woocommerce" | "shopify" | "daraz";
export type OrderSourceId = "woocommerce" | "shopify";
export type ImportSourceId = ProductSourceId;

export interface CurrencyOptions {
  /** ISO code the admin declares the file's prices are in. Default "BDT". */
  sourceCurrency: string;
  /**
   * BDT per 1 unit of sourceCurrency, as a decimal string (e.g.
   * "119.50"). Required when sourceCurrency !== "BDT"; ignored for BDT.
   */
  exchangeRateToBdt?: string | null;
}

export interface MappingEntry {
  source: string;
  target: string;
  note?: string;
}

export interface SkippedSourceRow {
  /** 1-based file row number (header = row 1, first data row = 2). */
  sourceRow: number;
  /** Human identifier for the row (SKU / name / order id) when known. */
  sourceRef: string;
  reason: string;
}

export interface MappedProductRow {
  sourceRow: number;
  sourceRef: string;
  /** Pipeline row shape: keys are the catalog import headers. */
  values: Record<string, string>;
}

export interface ProductMapResult {
  rows: MappedProductRow[];
  skipped: SkippedSourceRow[];
  /** Original file headers (as parsed, lower-cased) never consumed. */
  unmappedColumns: string[];
  /** File headers the mapper did consume (original spelling). */
  consumedColumns: string[];
  notes: string[];
  /** Platform product count detected (distinct slugs). */
  productCount: number;
}

export interface InvalidReportRow {
  sourceRow: number;
  sourceRef: string;
  field: string;
  message: string;
}

export interface CategoryWarning {
  slug: string;
  categorySlug: string;
  message: string;
}

export interface ProductImportReport {
  source: ProductSourceId;
  kind: "products";
  fileName: string | null;
  /** True for template-based mappers whose columns could not be
   *  verified against a real export (Daraz). Surfaced in the UI. */
  templateBased: boolean;
  currency: {
    source: string;
    exchangeRateToBdt: string | null;
    converted: boolean;
  };
  totalSourceRows: number;
  mappedRowCount: number;
  productCount: number;
  validCount: number;
  invalidCount: number;
  invalidRows: InvalidReportRow[];
  skippedSourceRows: SkippedSourceRow[];
  unmappedColumns: string[];
  consumedColumns: string[];
  categoryWarnings: CategoryWarning[];
  notes: string[];
  mapping: MappingEntry[];
  /** The mapped file in the platform's native import format. The
   *  admin UI posts THIS to the existing /products/import/confirm
   *  endpoint, so persistence semantics are identical to a native
   *  import (DRAFT-only, per-row outcomes, audit). */
  platformCsv: string;
  /** The pipeline's error-report CSV for the mapped file. */
  errorReportCsv: string;
}

/** Fatal, whole-file refusal (e.g. non-BDT file with no rate). */
export interface ImportRefusal {
  refused: true;
  code: string;
  message: string;
}
