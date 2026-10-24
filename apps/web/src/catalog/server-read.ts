// Server-side catalog reads for pages (server components) — DB swap
// follow-up, 2026-10-24. Pages must render HONEST empty states when the
// catalog is empty or the DB is not ready yet — never mock data — so
// every helper here resolves to an empty result instead of throwing.
// Runtime data comes ONLY from the Prisma repository via
// getCatalogRepository() (./api.ts); src/catalog/mock.ts is a labelled
// test fixture and is not imported here.

import { getCatalogRepository } from "./api";
import type { CatalogRepository } from "./service";
import type { Category, Product, PublicProduct } from "./types";
import { toPublicProduct } from "./types";

/** The Prisma catalog repository, or null when the DB is not ready. */
export async function tryCatalogRepository(): Promise<CatalogRepository | null> {
  try {
    return await getCatalogRepository();
  } catch {
    return null;
  }
}

/** ACTIVE products only (the storefront-visible set), newest first.
 *  ADMIN/full shape — variants include costPoisha. Server-side admin
 *  pages only; NEVER pass the result to a client component on a public
 *  surface (it would serialize cost into the RSC payload). Public pages
 *  must use listActivePublicProducts / listPublicProducts below. */
export async function listActiveProducts(pageSize = 100): Promise<Product[]> {
  const repo = await tryCatalogRepository();
  if (!repo) return [];
  const result = await repo.listProducts({ status: "ACTIVE", page: 1, pageSize });
  return result.products;
}

/**
 * PUBLIC read path — the ONLY product list a public page may hand to a
 * client component. Same ACTIVE set as listActiveProducts, but every
 * product is shaped by toPublicProduct, so costPoisha never exists in
 * the returned graph (privacy fix, 2026-10-24: cost was riding the RSC
 * payload of home/shop/search/cart through ProductCard props).
 */
export async function listActivePublicProducts(pageSize = 100): Promise<PublicProduct[]> {
  const products = await listActiveProducts(pageSize);
  return products.map(toPublicProduct);
}

/** PUBLIC filtered list (shop/search filters) with cost stripped. */
export async function listPublicProducts(
  filter: Parameters<CatalogRepository["listProducts"]>[0],
): Promise<{ products: PublicProduct[]; total: number; page: number; pageSize: number }> {
  const repo = await tryCatalogRepository();
  if (!repo) return { products: [], total: 0, page: 1, pageSize: filter.pageSize ?? 100 };
  const result = await repo.listProducts({ ...filter, status: "ACTIVE" });
  return { ...result, products: result.products.map(toPublicProduct) };
}

/**
 * PUBLIC search (the /search page): Meilisearch-first through
 * searchPublicProducts with the Postgres fallback inside it, and the
 * answering engine returned for honest display. When the DB itself is
 * not ready the page renders its empty state labelled as the Postgres
 * path (no results were served by any engine).
 */
export async function searchPublicProductsForPage(
  filter: Parameters<CatalogRepository["listProducts"]>[0],
): Promise<{ products: PublicProduct[]; total: number; page: number; pageSize: number; engine: "meilisearch" | "postgres" }> {
  const repo = await tryCatalogRepository();
  if (!repo) return { products: [], total: 0, page: 1, pageSize: filter.pageSize ?? 100, engine: "postgres" };
  const { searchPublicProducts } = await import("./search-service");
  return searchPublicProducts(repo, filter);
}

/**
 * Every non-deleted product across all statuses (DRAFT + ACTIVE +
 * ARCHIVED), newest first — for ADMIN surfaces that legitimately show
 * drafts. The repository contract filters per status, so this merges
 * the three status queries; it never widens the PUBLIC read path.
 */
export async function listAllProducts(pageSizePerStatus = 100): Promise<Product[]> {
  const repo = await tryCatalogRepository();
  if (!repo) return [];
  const byId = new Map<string, Product>();
  for (const status of ["ACTIVE", "DRAFT", "ARCHIVED"] as const) {
    const result = await repo.listProducts({ status, page: 1, pageSize: pageSizePerStatus });
    for (const product of result.products) byId.set(product.id, product);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Live categories with ACTIVE-product counts (same source as the public categories API). */
export async function listCategories(): Promise<Category[]> {
  const repo = await tryCatalogRepository();
  if (!repo) return [];
  return repo.getCategories();
}
