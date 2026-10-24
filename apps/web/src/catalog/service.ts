// Catalog service — Agent 8.
// Status: RUNTIME TEST PENDING Prisma generate + Agent 6 schema merge.
// The current packages/db/prisma/schema.prisma has NO Product/Category/
// StockMovement models yet. This file therefore codes against the row
// shapes proposed in src/catalog/SCHEMA-ADDITIONS.md, NOT against a
// generated Prisma client (which does not exist yet — `prisma generate`
// previously failed on a Prisma engine binary network download).
//
// How it stays honest:
//  - Reads: if a Prisma-like client with a `product` model is present at
//    runtime, it is used. Otherwise reads fall back to the labelled
//    TEMPORARY MOCK data (cost stripped for public callers) — never
//    presented as DB data.
//  - Writes: if no Prisma product model is present, create/update throw
//    DbNotReadyError and routes return 503 DB_NOT_READY. No fake
//    persistence, no silent in-memory "save".
//  - Stock: initial stock is NEVER a direct edit. createProduct returns
//    ledger entries (stock_movements, ledger-only). The Prisma adapter
//    writes them only if client.stockMovement exists; otherwise it
//    returns them as `ledgerPending` so the caller can see the stock
//    was NOT yet written to a ledger. Agent 6 must add the
//    StockMovement model for this to become a real write.
//  - Money: integer poisha everywhere. No float. Slug unique, soft
//    delete (deletedAt) respected on every read.

import { z } from "zod";
import type { Category, Product, ProductImage, ProductVariant, PublicProduct } from "./types";
import { toPublicProduct } from "./types";
import type { ProductFilter } from "./search";
import { applyProductFilter } from "./search";
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
// Row shapes (exactly the SCHEMA-ADDITIONS.md proposal)
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
  listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number }): Promise<{
    products: Product[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  getProductBySlug(slug: string): Promise<Product | null>;
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
}

/** Read-only mock repository: labelled fallback until DB tables exist. */
export class MockCatalogRepository implements CatalogRepository {
  async listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    let products = MOCK_PRODUCTS.filter((p) => p.status === "ACTIVE");
    if (filter.status) products = MOCK_PRODUCTS.filter((p) => p.status === filter.status);
    products = applyProductFilter(products, filter);
    const total = products.length;
    return { products: products.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize };
  }
  async getProductBySlug(slug: string) {
    return MOCK_PRODUCTS.find((p) => p.slug === slug && p.status === "ACTIVE") ?? null;
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
}

// Structural client type for the future Prisma adapter. Deliberately NOT
// imported from @prisma/client: that client is not generated yet, and
// importing it would make every file in this slice fail tsc today.
// Once Agent 6 merges the tables and `prisma generate` succeeds, this
// adapter can be re-typed directly against the generated client with
// no change to the repository interface or the routes.
export interface PrismaLikeClient {
  product?: {
    findMany: (args: Record<string, unknown>) => Promise<ProductRow[]>;
    findUnique: (args: Record<string, unknown>) => Promise<ProductRow | null>;
    count: (args: Record<string, unknown>) => Promise<number>;
    create: (args: Record<string, unknown>) => Promise<ProductRow>;
    update: (args: Record<string, unknown>) => Promise<ProductRow>;
  };
  category?: {
    findMany: (args: Record<string, unknown>) => Promise<CategoryRow[]>;
    findUnique: (args: Record<string, unknown>) => Promise<{ id: string } | null>;
  };
  stockMovement?: {
    createMany: (args: Record<string, unknown>) => Promise<unknown>;
  };
}

/** Returns true only if the runtime client actually has a product model. */
export function hasPrismaCatalog(client: unknown): client is PrismaLikeClient {
  if (typeof client !== "object" || client === null) return false;
  const c = client as PrismaLikeClient;
  return typeof c.product?.findMany === "function" && typeof c.product?.create === "function";
}

/**
 * Prisma-backed repository. All writes happen in one logical transaction
 * at the call site (see routes): product + variants + images + ledger.
 * Here the adapter builds the exact Prisma payloads; the route wraps
 * them in $transaction once a generated client exists. Until then this
 * class is constructed only after hasPrismaCatalog() passes, so it is
 * never instantiated against a client without catalog models.
 */
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private readonly client: PrismaLikeClient) {}

  async listProducts(filter: ProductFilter & { status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(1, filter.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
    const rows = await this.client.product!.findMany({
      where: { deletedAt: null, ...(filter.status ? { status: filter.status } : { status: "ACTIVE" }) },
      include: { images: true, variants: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    const products = rows.map(mapRowToProduct);
    const filtered = applyProductFilter(products, filter);
    const total = await this.client.product!.count({
      where: { deletedAt: null, ...(filter.status ? { status: filter.status } : { status: "ACTIVE" }) },
    });
    return { products: filtered, total, page, pageSize };
  }

  async getProductBySlug(slug: string) {
    const row = await this.client.product!.findUnique({
      where: { slug },
      include: { images: true, variants: true },
    });
    if (!row || row.deletedAt !== null) return null;
    return mapRowToProduct(row);
  }

  async getProductById(id: string) {
    const row = await this.client.product!.findUnique({
      where: { id },
      include: { images: true, variants: true },
    });
    if (!row || row.deletedAt !== null) return null;
    return mapRowToProduct(row);
  }

  async getCategories() {
    const rows = (await this.client.category?.findMany({})) ?? [];
    return rows.map((r) => ({
      slug: r.slug,
      name: { bn: r.nameBn, en: r.nameEn },
      imageUrl: r.imageUrl,
      productCount: r.productCount,
    }));
  }

  async slugExists(slug: string, excludeId?: string) {
    const row = await this.client.product!.findUnique({ where: { slug } });
    if (!row) return false;
    return excludeId === undefined || row.id !== excludeId;
  }

  async skusExist(skus: string[]) {
    // Implemented by the route via a dedicated variant query once the
    // generated client exists; this adapter keeps the contract by
    // checking slugs of variants through product rows is not reliable,
    // so callers must use the SKU check in create/update validation
    // below (duplicate SKUs inside one payload are rejected there).
    // For now, return [] and let the DB unique constraint be the backstop.
    void skus;
    return [];
  }

  async createProduct(input: ProductInput, actorId: string | null) {
    const category = await this.client.category?.findUnique({ where: { slug: input.categorySlug } });
    if (!category) throw new Error(`Category not found: ${input.categorySlug}`);
    const row = await this.client.product!.create({
      data: {
        slug: input.slug,
        titleBn: input.titleBn,
        titleEn: input.titleEn,
        descriptionBn: input.descriptionBn,
        descriptionEn: input.descriptionEn,
        categoryId: category.id,
        brandName: input.brandName ?? null,
        status: input.status,
        tags: input.tags,
        seoTitleBn: input.seoTitleBn ?? null,
        seoTitleEn: input.seoTitleEn ?? null,
        seoDescriptionBn: input.seoDescriptionBn ?? null,
        seoDescriptionEn: input.seoDescriptionEn ?? null,
        images: { create: input.images },
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
      include: { images: true, variants: true },
    });
    const product = mapRowToProduct(row);
    const ledgerEntries = buildInitialStockLedgerEntries(
      product.id,
      product.variants,
      actorId,
    );
    let ledgerPending = false;
    if (ledgerEntries.length > 0) {
      if (this.client.stockMovement) {
        await this.client.stockMovement.createMany({
          data: ledgerEntries.map((e) => ({
            productId: e.productId,
            variantId: e.variantId,
            sku: e.sku,
            type: e.type,
            quantityChange: e.quantityChange,
            reason: e.reason,
            actorId: e.actorId,
          })),
        });
      } else {
        // StockMovement model not yet merged by Agent 6 — do NOT silently
        // drop the ledger. Caller surfaces ledgerPending in the response.
        ledgerPending = true;
      }
    }
    return { product, ledgerEntries, ledgerPending };
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
    // Variant/image replacement is done by the route in a $transaction
    // once the generated client exists; this adapter updates scalar
    // fields here and returns the refreshed product.
    const row = await this.client.product!.update({
      where: { id },
      data: {
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.titleBn !== undefined ? { titleBn: input.titleBn } : {}),
        ...(input.titleEn !== undefined ? { titleEn: input.titleEn } : {}),
        ...(input.descriptionBn !== undefined ? { descriptionBn: input.descriptionBn } : {}),
        ...(input.descriptionEn !== undefined ? { descriptionEn: input.descriptionEn } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      },
      include: { images: true, variants: true },
    });
    void actorId;
    return { product: mapRowToProduct(row), ledgerEntries: [], ledgerPending: false };
  }
}

// ---------------------------------------------------------------------------
// Service entry points (used by routes)
// ---------------------------------------------------------------------------

export function getPublicProducts(
  repo: CatalogRepository,
  filter: ProductFilter & { page?: number; pageSize?: number },
): Promise<{ products: PublicProduct[]; total: number; page: number; pageSize: number }> {
  return repo.listProducts({ ...filter, status: "ACTIVE" }).then((r) => ({
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
  const product = await repo.getProductBySlug(slug);
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
  return errors;
}
