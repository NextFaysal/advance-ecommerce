// Catalog service — Agent 8; Prisma DB swap completed 2026-10-24.
// Persistence: PrismaCatalogRepository below is backed by the real
// generated Prisma client (@advance-ecommerce/db exports `prisma`) and
// the merged schema in packages/db/prisma/schema.prisma (Product /
// ProductVariant / ProductImage / Category / Brand / StockMovement /
// InventoryItem / Warehouse). Routes obtain it via
// getCatalogRepository() in ./api.ts, which throws DbNotReadyError
// (routes return 503 DB_NOT_READY) if the client is unavailable —
// runtime reads and writes hit the database ONLY; there is no mock
// fallback at runtime anymore. MockCatalogRepository is retained
// solely as a labelled in-memory fixture for tests.
//
// Invariants kept from the original contract:
//  - Money: integer poisha everywhere. No float.
//  - Slug unique (checked in routes, DB unique constraint is the
//    backstop); soft delete (deletedAt) respected on every read.
//  - Stock: variant.stock is a denormalized cache. Initial and adjusted
//    quantities are ALSO written to the stock_movements ledger plus
//    InventoryItem by the Prisma adapter (see the adapter notes for the
//    INITIAL_STOCK -> PURCHASE_RECEIVE mapping); if no warehouse exists
//    to book the movement against, the write reports
//    `ledgerPending: true` instead of silently dropping it.

import { z } from "zod";
import type {
  BundleComponentView,
  Category,
  DigitalFileMeta,
  FaqItem,
  PreorderTerms,
  Product,
  ProductImage,
  ProductType,
  ProductVariant,
  PublicProduct,
  SizeChart,
} from "./types";
import { computeBundleAvailability, toPublicProduct } from "./types";
import type { ProductFilter } from "./search";
import { applyProductFilter, expandQueryTokens } from "./search";
import { removeProductFromSearchIndex, syncProductSearchIndex } from "./indexer";
import { MOCK_CATEGORIES, MOCK_PRODUCTS } from "./mock";

export const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0980-\u09ff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-");
}

export class DbNotReadyError extends Error {
  readonly code = "DB_NOT_READY";
  constructor(message = "Catalog tables are not yet migrated and Prisma client is not generated.") {
    super(message);
    this.name = "DbNotReadyError";
  }
}

// ---------------------------------------------------------------------------
// Zod input schemas (every API input goes through these)
// ---------------------------------------------------------------------------

export const variantInputSchema = z.object({
  attributes: z.record(z.string()).default({}),
  sku: z.string().min(1).max(64),
  barcode: z.string().min(1).max(64).nullable().optional(),
  pricePoisha: z.number().int().min(0),
  compareAtPoisha: z.number().int().min(0).nullable().optional(),
  // costPoisha is staff-only: routes strip it unless the caller has
  // products.edit_cost_price (see rbac.ts). It is never returned publicly.
  costPoisha: z.number().int().min(0).nullable().optional(),
  stock: z.number().int().min(0).default(0),
  imageUrl: z.string().url().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const imageInputSchema = z.object({
  url: z.string().min(1).max(2048),
  altBn: z.string().max(255).default(""),
  altEn: z.string().max(255).default(""),
  sortOrder: z.number().int().min(0).default(0),
});

/** Size-chart Json shape (wave 14) — caps keep one product's chart a
 *  sane table: ≤12 columns, ≤50 rows, short cells. */
export const sizeChartSchema = z.object({
  headers: z.array(z.string().max(100)).min(1).max(12),
  rows: z.array(z.array(z.string().max(200)).max(12)).max(50),
});

/** FAQ Json shape (wave 14) — ≤30 Q/A pairs per product. */
export const faqItemsSchema = z
  .array(
    z.object({
      q: z.string().min(1).max(300),
      a: z.string().min(1).max(2000),
    }),
  )
  .max(30);

/** Non-negative integer or null — physicals + thresholds (wave 14). */
const nonNegativeIntOrNull = z.number().int().min(0).nullable().optional();

/** Product types (wave 15, doc 16 P7) — gated by module.product_types
 *  at the route layer; the schema accepts the payloads so the editor
 *  can round-trip them. */
export const PRODUCT_TYPES = ["SIMPLE", "DIGITAL", "BUNDLE", "PREORDER"] as const;

/** One digital file row as the editor sends it: metadata captured from
 *  the presigned upload ticket (storageKey + fileName + sizeBytes).
 *  `id` rides along on updates for readability; replace semantics key
 *  on storageKey, so the id is accepted and ignored. */
export const digitalFileInputSchema = z.object({
  id: z.string().max(64).optional(),
  storageKey: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(1),
});

export const bundleComponentInputSchema = z.object({
  variantId: z.string().min(1).max(64),
  quantity: z.number().int().min(1).max(10000).default(1),
});

/** Pre-order terms (wave 15): depositPercent is informational for
 *  checkout display this wave (no payment split); maxUnits caps the
 *  total non-cancelled ordered units across all orders. */
export const preorderInputSchema = z.object({
  depositPercent: z.number().int().min(0).max(100).nullable().optional(),
  expectedDate: z.string().max(32).nullable().optional(),
  maxUnits: z.number().int().min(1).nullable().optional(),
});

export const productInputSchema = z.object({
  slug: z.string().regex(SLUG_REGEX, "Slug must be lowercase letters, digits and hyphens only"),
  titleBn: z.string().min(1).max(255),
  titleEn: z.string().min(1).max(255),
  descriptionBn: z.string().min(1),
  descriptionEn: z.string().min(1),
  categorySlug: z.string().min(1).max(128),
  brandName: z.string().max(128).nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("DRAFT"),
  tags: z.array(z.string().max(64)).max(50).default([]),
  seoTitleBn: z.string().max(255).nullable().optional(),
  seoTitleEn: z.string().max(255).nullable().optional(),
  seoDescriptionBn: z.string().max(500).nullable().optional(),
  seoDescriptionEn: z.string().max(500).nullable().optional(),
  ogImage: z.string().url().max(2048).nullable().optional(),
  // --- Wave 14 (doc 16 P5/P6): content, scheduling, merchandising ---
  videoUrl: z.string().url().max(2048).nullable().optional(),
  sizeChart: sizeChartSchema.nullable().optional(),
  faqItems: faqItemsSchema.nullable().optional(),
  // ISO datetime strings on the wire; the adapter stores Dates.
  publishAt: z.string().datetime().nullable().optional(),
  saleStartsAt: z.string().datetime().nullable().optional(),
  saleEndsAt: z.string().datetime().nullable().optional(),
  relatedIds: z.array(z.string().min(1).max(64)).max(20).default([]),
  weightGrams: nonNegativeIntOrNull,
  lengthMm: nonNegativeIntOrNull,
  widthMm: nonNegativeIntOrNull,
  heightMm: nonNegativeIntOrNull,
  lowStockThreshold: nonNegativeIntOrNull,
  // --- Wave 15 (doc 16 P7): product types ---
  type: z.enum(PRODUCT_TYPES).default("SIMPLE"),
  digitalFiles: z.array(digitalFileInputSchema).max(50).default([]),
  bundleComponents: z.array(bundleComponentInputSchema).max(100).default([]),
  preorder: preorderInputSchema.nullable().optional(),
  images: z.array(imageInputSchema).max(20).default([]),
  variants: z.array(variantInputSchema).min(1).max(200),
});

export const productUpdateSchema = productInputSchema.partial().extend({
  // Price changes are a sensitive action (audit.ts): reason is required
  // by the route whenever any variant pricePoisha changes.
  reason: z.string().max(500).optional(),
});

export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
export type VariantInput = z.infer<typeof variantInputSchema>;

// ---------------------------------------------------------------------------
// Row shapes (service-internal flattened contract; the Prisma adapter
// maps real schema rows — relations included — into these shapes)
// ---------------------------------------------------------------------------

export interface ProductRow {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  categoryId: string;
  categorySlug: string;
  categoryNameBn: string;
  categoryNameEn: string;
  brandName: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  tags: string[];
  ratingAverage: number | null;
  reviewCount: number;
  seoTitleBn: string | null;
  seoTitleEn: string | null;
  seoDescriptionBn: string | null;
  seoDescriptionEn: string | null;
  ogImage: string | null;
  videoUrl: string | null;
  sizeChart: SizeChart | null;
  faqItems: FaqItem[] | null;
  publishAt: Date | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  relatedIds: string[];
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lowStockThreshold: number | null;
  type: ProductType;
  digitalFiles: DigitalFileMeta[];
  bundleComponents: BundleComponentView[];
  preorder: PreorderTerms | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  images: { id: string; url: string; altBn: string; altEn: string; sortOrder: number }[];
  variants: {
    id: string;
    productId: string;
    attributes: Record<string, string>;
    sku: string;
    barcode: string | null;
    pricePoisha: number;
    compareAtPoisha: number | null;
    costPoisha: number | null;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  }[];
}

export interface CategoryRow {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  imageUrl: string | null;
  productCount: number;
}

export function mapRowToProduct(row: ProductRow): Product {
  const images: ProductImage[] = [...row.images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((i) => ({ id: i.id, url: i.url, altBn: i.altBn, altEn: i.altEn, sortOrder: i.sortOrder }));
  const variants: ProductVariant[] = row.variants.map((v) => ({
    id: v.id,
    productId: v.productId,
    attributes: v.attributes,
    sku: v.sku,
    barcode: v.barcode,
    pricePoisha: v.pricePoisha,
    compareAtPoisha: v.compareAtPoisha,
    costPoisha: v.costPoisha,
    stock: v.stock,
    imageUrl: v.imageUrl,
    isActive: v.isActive,
  }));
  return {
    id: row.id,
    slug: row.slug,
    title: { bn: row.titleBn, en: row.titleEn },
    description: { bn: row.descriptionBn, en: row.descriptionEn },
    categorySlug: row.categorySlug,
    categoryName: { bn: row.categoryNameBn, en: row.categoryNameEn },
    brandName: row.brandName,
    status: row.status,
    images,
    variants,
    ratingAverage: row.ratingAverage,
    reviewCount: row.reviewCount,
    tags: row.tags,
    seoTitle:
      row.seoTitleBn !== null || row.seoTitleEn !== null
        ? { bn: row.seoTitleBn ?? "", en: row.seoTitleEn ?? "" }
        : null,
    seoDescription:
      row.seoDescriptionBn !== null || row.seoDescriptionEn !== null
        ? { bn: row.seoDescriptionBn ?? "", en: row.seoDescriptionEn ?? "" }
        : null,
    ogImage: row.ogImage,
    videoUrl: row.videoUrl,
    sizeChart: row.sizeChart,
    faqItems: row.faqItems,
    publishAt: row.publishAt ? row.publishAt.toISOString() : null,
    saleStartsAt: row.saleStartsAt ? row.saleStartsAt.toISOString() : null,
    saleEndsAt: row.saleEndsAt ? row.saleEndsAt.toISOString() : null,
    relatedIds: row.relatedIds,
    weightGrams: row.weightGrams,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    lowStockThreshold: row.lowStockThreshold,
    type: row.type,
    digitalFiles: row.digitalFiles,
    bundleComponents: row.bundleComponents,
    bundleAvailability:
      row.type === "BUNDLE" ? computeBundleAvailability(row.bundleComponents) : null,
    preorder: row.preorder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Stock ledger (ledger-only, never a direct stock edit)
// ---------------------------------------------------------------------------

export interface StockLedgerEntry {
  productId: string;
  variantId: string;
  sku: string;
  type: "INITIAL_STOCK" | "ADJUSTMENT" | "RESERVE" | "COMMIT" | "RELEASE" | "RESTORE";
  quantityChange: number; // +N for initial stock, never a direct overwrite
  reason: string;
  actorId: string | null;
}

/** Pure: build INITIAL_STOCK entries for every variant with stock > 0. */
export function buildInitialStockLedgerEntries(
  productId: string,
  variants: { id: string; sku: string; stock: number }[],
  actorId: string | null,
): StockLedgerEntry[] {
  return variants
    .filter((v) => v.stock > 0)
    .map((v) => ({
      productId,
      variantId: v.id,
      sku: v.sku,
      type: "INITIAL_STOCK" as const,
      quantityChange: v.stock,
      reason: "Initial stock on product create (ledger-only)",
      actorId,
    }));
}

// ---------------------------------------------------------------------------
// Repository interface (Prisma adapter implements this once tables exist)
// ---------------------------------------------------------------------------

export interface CatalogRepository {
  /**
   * List non-deleted products. `status` semantics: a specific status
   * (ACTIVE/DRAFT/ARCHIVED) filters; "ALL" returns every status (admin
   * surfaces only — public callers must keep the ACTIVE rule below);
   * omitted status defaults to ACTIVE.
   *
   * `liveOnly` (wave 14 scheduling gate): set ONLY by public callers.
   * When true AND the resolved status is ACTIVE, products whose
   * publishAt is still in the future are excluded — a read-time gate,
   * no worker flips anything. Admin callers never set it, so drafts,
   * scheduled products and every other status read exactly as before.
   */
  listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number; liveOnly?: boolean }): Promise<{
    products: Product[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  getProductBySlug(slug: string): Promise<Product | null>;
  /**
   * PUBLIC read path: only ACTIVE, non-deleted products are visible.
   * The status rule lives HERE, in the repository layer, so no public
   * caller can ever resolve a DRAFT/ARCHIVED product by slug. Admin
   * reads keep using getProductBySlug/getProductById (all statuses).
   */
  getPublicProductBySlug(slug: string): Promise<Product | null>;
  getProductById(id: string): Promise<Product | null>;
  getCategories(): Promise<Category[]>;
  slugExists(slug: string, excludeId?: string): Promise<boolean>;
  skusExist(skus: string[]): Promise<string[]>;
  createProduct(
    input: ProductInput,
    actorId: string | null,
  ): Promise<{ product: Product; ledgerEntries: StockLedgerEntry[]; ledgerPending: boolean }>;
  updateProduct(
    id: string,
    input: ProductUpdateInput,
    actorId: string | null,
  ): Promise<{ product: Product; ledgerEntries: StockLedgerEntry[]; ledgerPending: boolean }>;
  /**
   * SOFT delete only: sets deletedAt on the product and its live
   * variants (never a hard delete — order history references variants).
   * Returns null when no product row exists at all; `alreadyDeleted`
   * distinguishes a first delete from an idempotent repeat.
   */
  deleteProduct(id: string): Promise<{ product: Product; alreadyDeleted: boolean } | null>;
}

/**
 * In-memory fixture repository over the labelled TEMPORARY MOCK data.
 * Retained for tests only — runtime routes no longer use it:
 * getCatalogRepository() in ./api.ts returns the Prisma repository or
 * throws DbNotReadyError. If the DB is empty the API returns empty
 * results, never this mock data.
 */
export class MockCatalogRepository implements CatalogRepository {
  async listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number; liveOnly?: boolean }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    // Parity with the Prisma adapter: "ALL" = every status, a specific
    // status filters, no status defaults to ACTIVE.
    let products =
      filter.status === "ALL"
        ? [...MOCK_PRODUCTS]
        : MOCK_PRODUCTS.filter((p) => p.status === (filter.status ?? "ACTIVE"));
    // Fixture parity for the wave-14 gate: liveOnly + ACTIVE hides
    // future-publishAt products, exactly like the Prisma adapter.
    if (filter.liveOnly === true && (filter.status ?? "ACTIVE") === "ACTIVE") {
      const now = Date.now();
      products = products.filter((p) => p.publishAt === null || new Date(p.publishAt).getTime() <= now);
    }
    products = applyProductFilter(products, filter);
    const total = products.length;
    return { products: products.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
  }
  async getProductBySlug(slug: string) {
    return MOCK_PRODUCTS.find((p) => p.slug === slug && p.status === "ACTIVE") ?? null;
  }
  async getPublicProductBySlug(slug: string) {
    // Fixture parity with the Prisma adapter: public reads are
    // ACTIVE-only AND publishAt-gated (a future publishAt is a 404).
    const now = Date.now();
    return (
      MOCK_PRODUCTS.find(
        (p) =>
          p.slug === slug &&
          p.status === "ACTIVE" &&
          (p.publishAt === null || new Date(p.publishAt).getTime() <= now),
      ) ?? null
    );
  }
  async getProductById(id: string) {
    return MOCK_PRODUCTS.find((p) => p.id === id) ?? null;
  }
  async getCategories(): Promise<Category[]> {
    return MOCK_CATEGORIES;
  }
  async slugExists(slug: string) {
    return MOCK_PRODUCTS.some((p) => p.slug === slug);
  }
  async skusExist(skus: string[]) {
    const existing = new Set(MOCK_PRODUCTS.flatMap((p) => p.variants.map((v) => v.sku)));
    return skus.filter((s) => existing.has(s));
  }
  async createProduct(): Promise<never> {
    throw new DbNotReadyError("Product create requires migrated catalog tables + generated Prisma client.");
  }
  async updateProduct(): Promise<never> {
    throw new DbNotReadyError("Product update requires migrated catalog tables + generated Prisma client.");
  }
  async deleteProduct(): Promise<never> {
    throw new DbNotReadyError("Product delete requires migrated catalog tables + generated Prisma client.");
  }
}

// ---------------------------------------------------------------------------
// Prisma adapter — real merged schema (packages/db/prisma/schema.prisma)
// ---------------------------------------------------------------------------
// The merged schema differs from the original SCHEMA-ADDITIONS.md
// proposal in three ways this adapter absorbs:
//  1. Product has NO brandName column: brand is a Brand relation
//     (brandId). Reads flatten brand.name -> brandName; writes resolve a
//     brand name to a Brand row (find-or-create by unique name/slug).
//  2. Category is a relation: reads include it and flatten slug/names;
//     writes resolve categorySlug -> categoryId. Category has no
//     productCount column: getCategories computes it with _count over
//     non-deleted ACTIVE products.
//  3. StockMovement has no INITIAL_STOCK type and requires warehouseId,
//     quantityBefore/quantityAfter and a reference. Service-level
//     ledger types map to the DB enum via DB_STOCK_MOVEMENT_TYPE
//     (INITIAL_STOCK -> PURCHASE_RECEIVE); movements are booked against
//     the default (earliest-created active) warehouse with
//     referenceType PRODUCT_CREATE / PRODUCT_UPDATE and
//     referenceId = product id, and a matching InventoryItem row is
//     upserted so quantityOnHand tracks the variant.stock cache.

/** Real Prisma row shape for a product with catalog relations included. */
export interface PrismaProductRow {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  categoryId: string;
  brandId: string | null;
  status: string;
  tags: string[];
  ratingAverage: number | null;
  reviewCount: number;
  seoTitleBn: string | null;
  seoTitleEn: string | null;
  seoDescriptionBn: string | null;
  seoDescriptionEn: string | null;
  ogImage: string | null;
  videoUrl: string | null;
  // Prisma Json columns arrive untyped; normalized in the mapper below.
  sizeChart: unknown;
  faqItems: unknown;
  publishAt: Date | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
  relatedIds: string[];
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lowStockThreshold: number | null;
  type: string;
  preorderDepositPercent: number | null;
  preorderExpectedDate: Date | null;
  preorderMaxUnits: number | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  category: { slug: string; nameBn: string; nameEn: string };
  brand: { name: string } | null;
  digitalFiles: {
    id: string;
    storageKey: string;
    fileName: string;
    sizeBytes: number;
    createdAt: Date;
  }[];
  bundleComponents: {
    quantity: number;
    componentVariant: {
      id: string;
      sku: string;
      stock: number;
      pricePoisha: number;
      attributes: unknown;
      product: { titleBn: string; titleEn: string; slug: string };
    };
  }[];
  images: { id: string; url: string; altBn: string; altEn: string; sortOrder: number }[];
  variants: {
    id: string;
    productId: string;
    attributes: unknown;
    sku: string;
    barcode: string | null;
    pricePoisha: number;
    compareAtPoisha: number | null;
    costPoisha: number | null;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  }[];
}

/** Real Prisma row shape for a category with an ACTIVE-product count. */
export interface PrismaCategoryRow {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  imageUrl: string | null;
  _count: { products: number };
}

function normalizeAttributes(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) out[k] = typeof v === "string" ? v : String(v);
  return out;
}

/** Defensive read of the sizeChart Json column: anything that does not
 *  match the contract shape reads as null (writes are zod-validated,
 *  so this only guards hand-edited/legacy rows). */
function normalizeSizeChart(value: unknown): SizeChart | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as { headers?: unknown; rows?: unknown };
  if (!Array.isArray(v.headers) || !v.headers.every((h) => typeof h === "string")) return null;
  if (
    !Array.isArray(v.rows) ||
    !v.rows.every((r) => Array.isArray(r) && r.every((c) => typeof c === "string"))
  ) {
    return null;
  }
  return { headers: v.headers as string[], rows: v.rows as string[][] };
}

/** Defensive read of the faqItems Json column (same rule as sizeChart). */
function normalizeFaqItems(value: unknown): FaqItem[] | null {
  if (!Array.isArray(value)) return null;
  const out: FaqItem[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const it = item as { q?: unknown; a?: unknown };
    if (typeof it.q !== "string" || typeof it.a !== "string") return null;
    out.push({ q: it.q, a: it.a });
  }
  return out;
}

/** Flatten a real Prisma product row into the service-internal ProductRow. */
export function mapPrismaRowToProductRow(row: PrismaProductRow): ProductRow {
  return {
    id: row.id,
    slug: row.slug,
    titleBn: row.titleBn,
    titleEn: row.titleEn,
    descriptionBn: row.descriptionBn,
    descriptionEn: row.descriptionEn,
    categoryId: row.categoryId,
    categorySlug: row.category.slug,
    categoryNameBn: row.category.nameBn,
    categoryNameEn: row.category.nameEn,
    brandName: row.brand?.name ?? null,
    status: row.status === "ACTIVE" || row.status === "ARCHIVED" ? row.status : "DRAFT",
    tags: row.tags,
    ratingAverage: row.ratingAverage,
    reviewCount: row.reviewCount,
    seoTitleBn: row.seoTitleBn,
    seoTitleEn: row.seoTitleEn,
    seoDescriptionBn: row.seoDescriptionBn,
    seoDescriptionEn: row.seoDescriptionEn,
    ogImage: row.ogImage,
    videoUrl: row.videoUrl,
    sizeChart: normalizeSizeChart(row.sizeChart),
    faqItems: normalizeFaqItems(row.faqItems),
    publishAt: row.publishAt,
    saleStartsAt: row.saleStartsAt,
    saleEndsAt: row.saleEndsAt,
    relatedIds: row.relatedIds ?? [],
    weightGrams: row.weightGrams,
    lengthMm: row.lengthMm,
    widthMm: row.widthMm,
    heightMm: row.heightMm,
    lowStockThreshold: row.lowStockThreshold,
    type: PRODUCT_TYPES.includes(row.type as ProductType) ? (row.type as ProductType) : "SIMPLE",
    digitalFiles: (row.digitalFiles ?? []).map((f) => ({
      id: f.id,
      storageKey: f.storageKey,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt.toISOString(),
    })),
    bundleComponents: (row.bundleComponents ?? []).map((c) => ({
      variantId: c.componentVariant.id,
      sku: c.componentVariant.sku,
      productTitle: { bn: c.componentVariant.product.titleBn, en: c.componentVariant.product.titleEn },
      productSlug: c.componentVariant.product.slug,
      variantLabel:
        c.componentVariant.attributes && typeof c.componentVariant.attributes === "object"
          ? Object.entries(c.componentVariant.attributes as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · ") || null
          : null,
      unitPricePoisha: c.componentVariant.pricePoisha,
      quantity: c.quantity,
      componentStock: c.componentVariant.stock,
    })),
    preorder:
      row.preorderDepositPercent !== null ||
      row.preorderExpectedDate !== null ||
      row.preorderMaxUnits !== null
        ? {
            depositPercent: row.preorderDepositPercent,
            expectedDate: row.preorderExpectedDate
              ? row.preorderExpectedDate.toISOString().slice(0, 10)
              : null,
            maxUnits: row.preorderMaxUnits,
          }
        : null,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    images: row.images,
    variants: row.variants.map((v) => ({ ...v, attributes: normalizeAttributes(v.attributes) })),
  };
}

const PRODUCT_INCLUDE = {
  category: { select: { slug: true, nameBn: true, nameEn: true } },
  brand: { select: { name: true } },
  images: true,
  variants: { where: { deletedAt: null } },
  digitalFiles: true,
  bundleComponents: {
    include: {
      componentVariant: {
        select: {
          id: true,
          sku: true,
          stock: true,
          pricePoisha: true,
          attributes: true,
          product: { select: { titleBn: true, titleEn: true, slug: true } },
        },
      },
    },
  },
};

/** Service ledger vocabulary -> StockMovementType DB enum. */
const DB_STOCK_MOVEMENT_TYPE: Record<StockLedgerEntry["type"], string> = {
  INITIAL_STOCK: "PURCHASE_RECEIVE",
  ADJUSTMENT: "ADJUSTMENT",
  RESERVE: "SALE_RESERVE",
  COMMIT: "SALE_COMMIT",
  RELEASE: "SALE_RELEASE",
  RESTORE: "SALE_RESTORE",
};

interface StockMovementWrite {
  variantId: string;
  type: StockLedgerEntry["type"];
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  reason: string;
  actorId: string | null;
}

// Structural client type for the Prisma adapter: the exact delegates of
// the generated client this repository uses, typed loosely on args.
// api.ts asserts the real client against it via hasPrismaCatalog(), so
// routes stay decoupled from @prisma/client imports.
export interface PrismaLikeClient {
  product: {
    findMany: (args: Record<string, unknown>) => Promise<PrismaProductRow[]>;
    findUnique: (args: Record<string, unknown>) => Promise<PrismaProductRow | null>;
    count: (args: Record<string, unknown>) => Promise<number>;
    create: (args: Record<string, unknown>) => Promise<PrismaProductRow>;
    update: (args: Record<string, unknown>) => Promise<PrismaProductRow>;
  };
  category: {
    findMany: (args: Record<string, unknown>) => Promise<PrismaCategoryRow[]>;
    findUnique: (args: Record<string, unknown>) => Promise<{ id: string; deletedAt: Date | null } | null>;
  };
  brand: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>;
    create: (args: Record<string, unknown>) => Promise<{ id: string }>;
  };
  productVariant: {
    findMany: (
      args: Record<string, unknown>,
    ) => Promise<{ sku: string; id?: string; productId?: string; deletedAt?: Date | null }[]>;
    create: (args: Record<string, unknown>) => Promise<{ id: string; sku: string; stock: number }>;
    update: (args: Record<string, unknown>) => Promise<unknown>;
  };
  productImage: {
    deleteMany: (args: Record<string, unknown>) => Promise<unknown>;
    createMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  digitalFile: {
    deleteMany: (args: Record<string, unknown>) => Promise<unknown>;
    createMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  bundleComponent: {
    deleteMany: (args: Record<string, unknown>) => Promise<unknown>;
    createMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  warehouse: {
    findFirst: (args: Record<string, unknown>) => Promise<{ id: string } | null>;
  };
  stockMovement: {
    createMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
  inventoryItem: {
    upsert: (args: Record<string, unknown>) => Promise<unknown>;
  };
  $transaction: <T>(fn: (tx: PrismaLikeClient) => Promise<T>) => Promise<T>;
}

/** Returns true only if the runtime client actually has the catalog delegates. */
export function hasPrismaCatalog(client: unknown): client is PrismaLikeClient {
  if (typeof client !== "object" || client === null) return false;
  const c = client as PrismaLikeClient;
  return (
    typeof c.product?.findMany === "function" &&
    typeof c.product?.create === "function" &&
    typeof c.category?.findMany === "function" &&
    typeof c.productVariant?.findMany === "function" &&
    typeof c.stockMovement?.createMany === "function" &&
    typeof c.$transaction === "function"
  );
}

/**
 * Prisma-backed repository against the real merged schema. Create and
 * update run inside a single $transaction: product + variants + images
 * + stock ledger (StockMovement + InventoryItem) commit or roll back
 * together.
 */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly client: PrismaLikeClient) {}

  async listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number; liveOnly?: boolean }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    // Status semantics: a specific status filters; "ALL" means every
    // status (the admin list); no status keeps the storefront-safe
    // ACTIVE default so a caller that forgets the filter can never
    // leak DRAFT/ARCHIVED products.
    const resolvedStatus = filter.status ?? "ACTIVE";
    const where = {
      deletedAt: null,
      ...(filter.status === "ALL" ? {} : { status: resolvedStatus }),
    };
    // Filters live in the SQL where (wave-13 parent fix, doc 16 #17):
    // previously q/category/brand/price/stock were applied in memory
    // AFTER pagination and `total` counted only the status filter, so
    // filtered totals and page contents were wrong.
    const variantSome: Record<string, unknown> = { isActive: true, deletedAt: null };
    if (filter.inStockOnly) variantSome.stock = { gt: 0 };
    if (filter.minPricePoisha !== undefined || filter.maxPricePoisha !== undefined) {
      variantSome.pricePoisha = {
        ...(filter.minPricePoisha !== undefined ? { gte: filter.minPricePoisha } : {}),
        ...(filter.maxPricePoisha !== undefined ? { lte: filter.maxPricePoisha } : {}),
      };
    }
    // Attribute filters (wave 14): each key:value becomes a JSON-path
    // equality on the variant attributes column, ANDed INSIDE the same
    // `some` — so one single variant must carry every pair (plus the
    // stock/price conditions above), exactly like applyProductFilter.
    const attributeEntries = filter.attributeFilters ? Object.entries(filter.attributeFilters) : [];
    if (attributeEntries.length > 0) {
      variantSome.AND = attributeEntries.map(([key, value]) => ({
        attributes: { path: [key], equals: value },
      }));
    }
    const needsVariantFilter =
      filter.inStockOnly ||
      filter.minPricePoisha !== undefined ||
      filter.maxPricePoisha !== undefined ||
      attributeEntries.length > 0;
    const queryTerms = filter.query ? expandQueryTokens(filter.query) : [];
    // OR-groups (search terms, the publishAt gate) are collected into
    // one AND array so they can never overwrite each other as keys.
    const andConditions: Record<string, unknown>[] = [];
    if (queryTerms.length > 0) {
      andConditions.push({
        OR: queryTerms.flatMap((t) => [
          { titleBn: { contains: t, mode: "insensitive" } },
          { titleEn: { contains: t, mode: "insensitive" } },
          { slug: { contains: t, mode: "insensitive" } },
        ]),
      });
    }
    // Wave-14 scheduling gate — the ONLY place the list path gates:
    // the caller must explicitly opt in with liveOnly (public callers
    // do; admin/POS/landing/jobs never set it) AND the resolved status
    // must be ACTIVE. A future publishAt then reads as "not listed".
    if (filter.liveOnly === true && resolvedStatus === "ACTIVE") {
      andConditions.push({ OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] });
    }
    const fullWhere: Record<string, unknown> = {
      ...where,
      ...(filter.categorySlug ? { category: { slug: filter.categorySlug } } : {}),
      ...(filter.brandName ? { brand: { name: filter.brandName } } : {}),
      ...(needsVariantFilter ? { variants: { some: variantSome } } : {}),
      ...(andConditions.length > 0 ? { AND: andConditions } : {}),
    };
    const orderBy =
      filter.sort === "rating"
        ? { ratingAverage: "desc" as const }
        : { createdAt: "desc" as const };
    const rows = await this.client.product.findMany({
      where: fullWhere,
      include: PRODUCT_INCLUDE,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const products = rows.map((r) => mapRowToProduct(mapPrismaRowToProductRow(r)));
    // applyProductFilter stays for the price sorts (no SQL equivalent for
    // min-variant-price ordering) — its filter predicates are idempotent
    // over rows the SQL already matched.
    const filtered = applyProductFilter(products, filter);
    const total = await this.client.product.count({ where: fullWhere });
    return { products: filtered, total, page, pageSize };
  }

  async getProductBySlug(slug: string) {
    const row = await this.client.product.findUnique({
      where: { slug },
      include: PRODUCT_INCLUDE,
    });
    if (!row || row.deletedAt !== null) return null;
    return mapRowToProduct(mapPrismaRowToProductRow(row));
  }

  async getPublicProductBySlug(slug: string) {
    // Status filter is part of the QUERY (not a post-check): a DRAFT or
    // ARCHIVED product is indistinguishable from a missing one here.
    // The wave-14 publishAt gate rides the same where: an ACTIVE
    // product scheduled for the future is equally invisible (publishAt
    // null = always live). This repository method is public-only —
    // admin reads use getProductBySlug/getProductById, which never
    // carry this gate.
    const rows = await this.client.product.findMany({
      where: {
        slug,
        status: "ACTIVE",
        OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }],
      },
      include: PRODUCT_INCLUDE,
      take: 1,
    });
    const row = rows[0];
    if (!row || row.deletedAt !== null) return null;
    return mapRowToProduct(mapPrismaRowToProductRow(row));
  }

  async getProductById(id: string) {
    const row = await this.client.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!row || row.deletedAt !== null) return null;
    return mapRowToProduct(mapPrismaRowToProductRow(row));
  }

  async getCategories(): Promise<Category[]> {
    const rows = await this.client.category.findMany({
      where: { deletedAt: null, isActive: true },
      include: {
        _count: { select: { products: { where: { deletedAt: null, status: "ACTIVE" } } } },
      },
      orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
    });
    return rows.map((r) => ({
      slug: r.slug,
      name: { bn: r.nameBn, en: r.nameEn },
      imageUrl: r.imageUrl,
      productCount: r._count.products,
    }));
  }

  async slugExists(slug: string, excludeId?: string) {
    // Slug is globally unique in the schema — including soft-deleted
    // rows — so any row with this slug blocks reuse.
    const row = await this.client.product.findUnique({ where: { slug }, select: { id: true } });
    if (!row) return false;
    return excludeId === undefined || row.id !== excludeId;
  }

  async skusExist(skus: string[]) {
    if (skus.length === 0) return [];
    // SKU is globally unique in the schema — including soft-deleted
    // variants — so check every variant row, not just live ones.
    const rows = await this.client.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    const found = new Set(rows.map((r) => r.sku));
    return skus.filter((s) => found.has(s));
  }

  /** Resolve a category slug to a live category id, or throw 404-mapped. */
  private async resolveCategoryId(client: PrismaLikeClient, categorySlug: string): Promise<string> {
    const category = await client.category.findUnique({
      where: { slug: categorySlug },
      select: { id: true, deletedAt: true },
    });
    if (!category || category.deletedAt !== null) {
      throw new Error(`Category not found: ${categorySlug}`);
    }
    return category.id;
  }

  /** Find-or-create a Brand row by its (unique) name. */
  private async resolveBrandId(client: PrismaLikeClient, brandName: string): Promise<string> {
    const byName = await client.brand.findFirst({
      where: { name: brandName, deletedAt: null },
      select: { id: true },
    });
    if (byName) return byName.id;
    const slug = slugify(brandName) || "brand";
    const bySlug = await client.brand.findFirst({
      where: { slug, deletedAt: null },
      select: { id: true },
    });
    if (bySlug) return bySlug.id;
    const created = await client.brand.create({ data: { name: brandName, slug }, select: { id: true } });
    return created.id;
  }

  /**
   * Persist stock movements to the ledger + InventoryItem against the
   * default warehouse. Returns false when no warehouse exists to book
   * against — callers surface that as ledgerPending instead of dropping
   * the entries. InventoryItem.quantityOnHand mirrors the
   * variant.stock cache (single-default-warehouse bookkeeping at this
   * stage; per-warehouse allocation lives in the inventory module).
   */
  private async persistStockMovements(
    client: PrismaLikeClient,
    rows: StockMovementWrite[],
    referenceType: string,
    referenceId: string,
  ): Promise<boolean> {
    if (rows.length === 0) return true;
    const warehouse = await client.warehouse.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (!warehouse) return false;
    await client.stockMovement.createMany({
      data: rows.map((r) => ({
        variantId: r.variantId,
        warehouseId: warehouse.id,
        type: DB_STOCK_MOVEMENT_TYPE[r.type],
        quantityDelta: r.quantityDelta,
        quantityBefore: r.quantityBefore,
        quantityAfter: r.quantityAfter,
        referenceType,
        referenceId,
        reason: r.reason,
        actorId: r.actorId,
      })),
    });
    for (const r of rows) {
      await client.inventoryItem.upsert({
        where: { variantId_warehouseId: { variantId: r.variantId, warehouseId: warehouse.id } },
        create: {
          variantId: r.variantId,
          warehouseId: warehouse.id,
          quantityOnHand: r.quantityAfter,
          quantityReserved: 0,
        },
        update: { quantityOnHand: r.quantityAfter },
      });
    }
    return true;
  }

  /**
   * Bundle component sanity (wave 15): components must be real, live
   * variants of OTHER products, never the bundle itself, and never a
   * variant of another BUNDLE (stock math stays single-level — a
   * bundle of bundles would need recursive reservation).
   */
  private async validateBundleComponents(
    client: PrismaLikeClient,
    bundleProductId: string | null,
    components: { variantId: string; quantity: number }[],
  ): Promise<void> {
    if (components.length === 0) return;
    const ids = components.map((c) => c.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new Error("Bundle component variants must be unique.");
    }
    const variants = await client.productVariant.findMany({
      where: { id: { in: ids } },
      select: { id: true, productId: true, deletedAt: true },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));
    for (const c of components) {
      const v = byId.get(c.variantId);
      if (!v || v.deletedAt !== null) {
        throw new Error(`Bundle component variant not found: ${c.variantId}`);
      }
      if (bundleProductId !== null && v.productId === bundleProductId) {
        throw new Error("Bundle components cannot belong to the bundle product itself.");
      }
    }
    const productIds = [...new Set(variants.map((v) => v.productId).filter((p): p is string => typeof p === "string"))];
    if (productIds.length > 0) {
      const products = await client.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, type: true },
      });
      for (const p of products) {
        if (p.type === "BUNDLE") {
          throw new Error("Bundle components cannot belong to another bundle product (no nested bundles).");
        }
      }
    }
  }

  async createProduct(input: ProductInput, actorId: string | null) {
    const result = await this.client.$transaction(async (tx) => {
      await this.validateBundleComponents(tx, null, input.bundleComponents);
      const categoryId = await this.resolveCategoryId(tx, input.categorySlug);
      const brandId =
        input.brandName !== null && input.brandName !== undefined && input.brandName !== ""
          ? await this.resolveBrandId(tx, input.brandName)
          : null;
      const row = await tx.product.create({
        data: {
          slug: input.slug,
          titleBn: input.titleBn,
          titleEn: input.titleEn,
          descriptionBn: input.descriptionBn,
          descriptionEn: input.descriptionEn,
          categoryId,
          brandId,
          status: input.status,
          tags: input.tags,
          seoTitleBn: input.seoTitleBn ?? null,
          seoTitleEn: input.seoTitleEn ?? null,
          seoDescriptionBn: input.seoDescriptionBn ?? null,
          seoDescriptionEn: input.seoDescriptionEn ?? null,
          ogImage: input.ogImage ?? null,
          videoUrl: input.videoUrl ?? null,
          sizeChart: input.sizeChart ?? null,
          faqItems: input.faqItems ?? null,
          publishAt: input.publishAt ? new Date(input.publishAt) : null,
          saleStartsAt: input.saleStartsAt ? new Date(input.saleStartsAt) : null,
          saleEndsAt: input.saleEndsAt ? new Date(input.saleEndsAt) : null,
          relatedIds: input.relatedIds,
          weightGrams: input.weightGrams ?? null,
          lengthMm: input.lengthMm ?? null,
          widthMm: input.widthMm ?? null,
          heightMm: input.heightMm ?? null,
          lowStockThreshold: input.lowStockThreshold ?? null,
          type: input.type,
          preorderDepositPercent: input.preorder?.depositPercent ?? null,
          preorderExpectedDate: input.preorder?.expectedDate
            ? new Date(input.preorder.expectedDate)
            : null,
          preorderMaxUnits: input.preorder?.maxUnits ?? null,
          digitalFiles: {
            create: input.digitalFiles.map((f) => ({
              storageKey: f.storageKey,
              fileName: f.fileName,
              sizeBytes: f.sizeBytes,
            })),
          },
          bundleComponents: {
            create: input.bundleComponents.map((c) => ({
              componentVariantId: c.variantId,
              quantity: c.quantity,
            })),
          },
          images: {
            create: input.images.map((i) => ({
              url: i.url,
              altBn: i.altBn,
              altEn: i.altEn,
              sortOrder: i.sortOrder,
            })),
          },
          variants: {
            create: input.variants.map((v) => ({
              attributes: v.attributes,
              sku: v.sku,
              barcode: v.barcode ?? null,
              pricePoisha: v.pricePoisha,
              compareAtPoisha: v.compareAtPoisha ?? null,
              costPoisha: v.costPoisha ?? null,
              stock: v.stock,
              imageUrl: v.imageUrl ?? null,
              isActive: v.isActive,
            })),
          },
        },
        include: PRODUCT_INCLUDE,
      });
      const product = mapRowToProduct(mapPrismaRowToProductRow(row));
      const ledgerEntries = buildInitialStockLedgerEntries(product.id, product.variants, actorId);
      let ledgerPending = false;
      if (ledgerEntries.length > 0) {
        const written = await this.persistStockMovements(
          tx,
          ledgerEntries.map((e) => ({
            variantId: e.variantId,
            type: e.type,
            quantityDelta: e.quantityChange,
            quantityBefore: 0,
            quantityAfter: e.quantityChange,
            reason: e.reason,
            actorId: e.actorId,
          })),
          "PRODUCT_CREATE",
          product.id,
        );
        ledgerPending = !written;
      }
      return { product, ledgerEntries, ledgerPending };
    });
    // Search-index sync (repository layer): fire-and-forget — a
    // Meilisearch outage never fails or delays the catalog write.
    syncProductSearchIndex(result.product);
    return result;
  }

  async updateProduct(id: string, input: ProductUpdateInput, actorId: string | null) {
    const existing = await this.getProductById(id);
    if (!existing) throw new Error("Product not found");
    const priceChanged =
      input.variants !== undefined &&
      input.variants.some((v) =>
        existing.variants.some((ev) => ev.sku === v.sku && ev.pricePoisha !== v.pricePoisha),
      );
    if (priceChanged && (input.reason === undefined || input.reason.trim() === "")) {
      throw new Error("Reason is required when variant prices change (products.price_change).");
    }
    const result = await this.client.$transaction(async (tx) => {
      if (input.bundleComponents !== undefined) {
        await this.validateBundleComponents(tx, id, input.bundleComponents);
      }
      const ledgerEntries: StockLedgerEntry[] = [];
      const movementRows: StockMovementWrite[] = [];

      if (input.variants !== undefined) {
        const existingBySku = new Map(existing.variants.map((v) => [v.sku, v]));
        const payloadSkus = new Set<string>();
        for (const v of input.variants) {
          payloadSkus.add(v.sku);
          const match = existingBySku.get(v.sku);
          if (match) {
            await tx.productVariant.update({
              where: { id: match.id },
              data: {
                attributes: v.attributes,
                barcode: v.barcode ?? null,
                pricePoisha: v.pricePoisha,
                compareAtPoisha: v.compareAtPoisha ?? null,
                costPoisha: v.costPoisha ?? null,
                stock: v.stock,
                imageUrl: v.imageUrl ?? null,
                isActive: v.isActive,
              },
            });
            if (v.stock !== match.stock) {
              const entry: StockLedgerEntry = {
                productId: id,
                variantId: match.id,
                sku: v.sku,
                type: "ADJUSTMENT",
                quantityChange: v.stock - match.stock,
                reason: input.reason ?? "Stock adjustment on product update (ledger-only)",
                actorId,
              };
              ledgerEntries.push(entry);
              movementRows.push({
                variantId: match.id,
                type: "ADJUSTMENT",
                quantityDelta: v.stock - match.stock,
                quantityBefore: match.stock,
                quantityAfter: v.stock,
                reason: entry.reason,
                actorId,
              });
            }
          } else {
            const createdVariant = await tx.productVariant.create({
              data: {
                productId: id,
                attributes: v.attributes,
                sku: v.sku,
                barcode: v.barcode ?? null,
                pricePoisha: v.pricePoisha,
                compareAtPoisha: v.compareAtPoisha ?? null,
                costPoisha: v.costPoisha ?? null,
                stock: v.stock,
                imageUrl: v.imageUrl ?? null,
                isActive: v.isActive,
              },
              select: { id: true, sku: true, stock: true },
            });
            if (v.stock > 0) {
              const entry: StockLedgerEntry = {
                productId: id,
                variantId: createdVariant.id,
                sku: v.sku,
                type: "INITIAL_STOCK",
                quantityChange: v.stock,
                reason: "Initial stock for variant added on product update (ledger-only)",
                actorId,
              };
              ledgerEntries.push(entry);
              movementRows.push({
                variantId: createdVariant.id,
                type: "INITIAL_STOCK",
                quantityDelta: v.stock,
                quantityBefore: 0,
                quantityAfter: v.stock,
                reason: entry.reason,
                actorId,
              });
            }
          }
        }
        // Variants dropped from the payload are soft-deleted, never
        // hard-deleted, so order history keeps its references.
        for (const ev of existing.variants) {
          if (!payloadSkus.has(ev.sku)) {
            await tx.productVariant.update({
              where: { id: ev.id },
              data: { deletedAt: new Date(), isActive: false },
            });
          }
        }
      }

      if (input.images !== undefined) {
        // ProductImage has no deletedAt column — replace semantics are
        // delete + recreate, inside this transaction.
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (input.images.length > 0) {
          await tx.productImage.createMany({
            data: input.images.map((i) => ({
              productId: id,
              url: i.url,
              altBn: i.altBn,
              altEn: i.altEn,
              sortOrder: i.sortOrder,
            })),
          });
        }
      }

      // Wave 15 per-type payloads — replace semantics, same contract
      // as images: when the field is present in the payload it fully
      // replaces the stored set (the editor always sends the full set).
      if (input.digitalFiles !== undefined) {
        await tx.digitalFile.deleteMany({ where: { productId: id } });
        if (input.digitalFiles.length > 0) {
          await tx.digitalFile.createMany({
            data: input.digitalFiles.map((f) => ({
              productId: id,
              storageKey: f.storageKey,
              fileName: f.fileName,
              sizeBytes: f.sizeBytes,
            })),
          });
        }
      }
      if (input.bundleComponents !== undefined) {
        await tx.bundleComponent.deleteMany({ where: { bundleProductId: id } });
        if (input.bundleComponents.length > 0) {
          await tx.bundleComponent.createMany({
            data: input.bundleComponents.map((c) => ({
              bundleProductId: id,
              componentVariantId: c.variantId,
              quantity: c.quantity,
            })),
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.type !== undefined) data.type = input.type;
      if (input.preorder !== undefined) {
        // null clears every term; an object replaces all three.
        data.preorderDepositPercent = input.preorder?.depositPercent ?? null;
        data.preorderExpectedDate = input.preorder?.expectedDate
          ? new Date(input.preorder.expectedDate)
          : null;
        data.preorderMaxUnits = input.preorder?.maxUnits ?? null;
      }
      if (input.titleBn !== undefined) data.titleBn = input.titleBn;
      if (input.titleEn !== undefined) data.titleEn = input.titleEn;
      if (input.descriptionBn !== undefined) data.descriptionBn = input.descriptionBn;
      if (input.descriptionEn !== undefined) data.descriptionEn = input.descriptionEn;
      if (input.status !== undefined) data.status = input.status;
      if (input.tags !== undefined) data.tags = input.tags;
      if (input.seoTitleBn !== undefined) data.seoTitleBn = input.seoTitleBn;
      if (input.seoTitleEn !== undefined) data.seoTitleEn = input.seoTitleEn;
      if (input.seoDescriptionBn !== undefined) data.seoDescriptionBn = input.seoDescriptionBn;
      if (input.seoDescriptionEn !== undefined) data.seoDescriptionEn = input.seoDescriptionEn;
      if (input.ogImage !== undefined) data.ogImage = input.ogImage;
      if (input.videoUrl !== undefined) data.videoUrl = input.videoUrl;
      if (input.sizeChart !== undefined) data.sizeChart = input.sizeChart;
      if (input.faqItems !== undefined) data.faqItems = input.faqItems;
      if (input.publishAt !== undefined) {
        data.publishAt = input.publishAt ? new Date(input.publishAt) : null;
      }
      if (input.saleStartsAt !== undefined) {
        data.saleStartsAt = input.saleStartsAt ? new Date(input.saleStartsAt) : null;
      }
      if (input.saleEndsAt !== undefined) {
        data.saleEndsAt = input.saleEndsAt ? new Date(input.saleEndsAt) : null;
      }
      if (input.relatedIds !== undefined) data.relatedIds = input.relatedIds;
      if (input.weightGrams !== undefined) data.weightGrams = input.weightGrams;
      if (input.lengthMm !== undefined) data.lengthMm = input.lengthMm;
      if (input.widthMm !== undefined) data.widthMm = input.widthMm;
      if (input.heightMm !== undefined) data.heightMm = input.heightMm;
      if (input.lowStockThreshold !== undefined) data.lowStockThreshold = input.lowStockThreshold;
      if (input.categorySlug !== undefined) {
        data.categoryId = await this.resolveCategoryId(tx, input.categorySlug);
      }
      if (input.brandName !== undefined) {
        data.brandId =
          input.brandName === null || input.brandName === ""
            ? null
            : await this.resolveBrandId(tx, input.brandName);
      }
      await tx.product.update({ where: { id }, data });

      let ledgerPending = false;
      if (movementRows.length > 0) {
        ledgerPending = !(await this.persistStockMovements(tx, movementRows, "PRODUCT_UPDATE", id));
      }

      const row = await tx.product.findUnique({ where: { id }, include: PRODUCT_INCLUDE });
      if (!row) throw new Error("Product not found");
      return {
        product: mapRowToProduct(mapPrismaRowToProductRow(row)),
        ledgerEntries,
        ledgerPending,
      };
    });
    // Search-index sync (repository layer): fire-and-forget, same
    // contract as createProduct — a status flip away from ACTIVE
    // makes the indexer delete the document.
    syncProductSearchIndex(result.product);
    return result;
  }

  async deleteProduct(id: string) {
    // Look the row up INCLUDING soft-deleted ones: getProductById
    // returns null for both missing and deleted, and the route must
    // distinguish "not found" (404) from "already deleted" (idempotent
    // success) — so this reads the raw row directly.
    const row = await this.client.product.findUnique({
      where: { id },
      include: PRODUCT_INCLUDE,
    });
    if (!row) return null;
    const product = mapRowToProduct(mapPrismaRowToProductRow(row));
    if (row.deletedAt !== null) {
      return { product, alreadyDeleted: true };
    }
    const now = new Date();
    await this.client.$transaction(async (tx) => {
      // Soft-delete the live variants too — the same treatment
      // updateProduct gives dropped variants: order history keeps its
      // references, but the orders repository's variant snapshots
      // filter deletedAt, so a deleted product can never be ordered
      // again. A hard delete is never performed here.
      for (const v of product.variants) {
        await tx.productVariant.update({
          where: { id: v.id },
          data: { deletedAt: now, isActive: false },
        });
      }
      await tx.product.update({ where: { id }, data: { deletedAt: now } });
    });
    // Search-index removal (repository layer, fire-and-forget — same
    // contract as the create/update sync hooks).
    removeProductFromSearchIndex(id);
    return { product, alreadyDeleted: false };
  }
}

// ---------------------------------------------------------------------------
// Service entry points (used by routes)
// ---------------------------------------------------------------------------

export function getPublicProducts(
  repo: CatalogRepository,
  filter: ProductFilter & { page?: number; pageSize?: number },
): Promise<{ products: PublicProduct[]; total: number; page: number; pageSize: number }> {
  // liveOnly: this is THE public list entry — the publishAt gate is on
  // here and only here (plus getPublicProductBySlug's own where).
  return repo.listProducts({ ...filter, status: "ACTIVE", liveOnly: true }).then((r) => ({
    products: r.products.map(toPublicProduct),
    total: r.total,
    page: r.page,
    pageSize: r.pageSize,
  }));
}

export async function getPublicProductBySlug(
  repo: CatalogRepository,
  slug: string,
): Promise<PublicProduct | null> {
  // Repository public path enforces ACTIVE-only; this layer only strips
  // the staff-only cost price for the public contract.
  const product = await repo.getPublicProductBySlug(slug);
  return product ? toPublicProduct(product) : null;
}

/** Shared create validation: slug format, duplicate SKUs inside payload. */
export function validateCreateInput(input: ProductInput): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const v of input.variants) {
    if (seen.has(v.sku)) errors.push(`Duplicate SKU in payload: ${v.sku}`);
    seen.add(v.sku);
  }
  const seenComponents = new Set<string>();
  for (const c of input.bundleComponents) {
    if (seenComponents.has(c.variantId)) {
      errors.push(`Duplicate bundle component in payload: ${c.variantId}`);
    }
    seenComponents.add(c.variantId);
  }
  const seenKeys = new Set<string>();
  for (const f of input.digitalFiles) {
    if (seenKeys.has(f.storageKey)) {
      errors.push(`Duplicate digital file in payload: ${f.storageKey}`);
    }
    seenKeys.add(f.storageKey);
  }
  return errors;
}
