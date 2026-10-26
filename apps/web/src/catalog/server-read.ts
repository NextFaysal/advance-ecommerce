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

/* ------------------------------------------------------------------ */
/* Speed wave (2026-10-26): short in-process TTL cache for the PUBLIC */
/* storefront reads below. A warm server instance serves the home /   */
/* shop / PDP renders from memory instead of re-querying Postgres on  */
/* every hit; data can lag up to the TTL (30s) — checkout always       */
/* re-validates price + stock live, so staleness here is display-only.*/
/* Only repository-backed results are cached (a DB-not-ready empty    */
/* result must never extend an outage). Admin reads are NOT cached.   */
/* ------------------------------------------------------------------ */
const PUBLIC_READ_TTL_MS = 30_000;
const publicReadCache = new Map<string, { at: number; value: unknown }>();

async function cachedPublicRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = publicReadCache.get(key);
  if (hit && Date.now() - hit.at < PUBLIC_READ_TTL_MS) return hit.value as T;
  const value = await load();
  publicReadCache.set(key, { at: Date.now(), value });
  return value;
}

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
 * Wave 14: this fetches with liveOnly directly (NOT via the admin
 * listActiveProducts) so scheduled (future publishAt) products stay
 * hidden here while admin surfaces keep seeing them.
 */
export async function listActivePublicProducts(pageSize = 100): Promise<PublicProduct[]> {
  const repo = await tryCatalogRepository();
  if (!repo) return [];
  return cachedPublicRead(`active-public:${pageSize}`, async () => {
    const result = await repo.listProducts({ status: "ACTIVE", page: 1, pageSize, liveOnly: true });
    return result.products.map(toPublicProduct);
  });
}

/** PUBLIC filtered list (shop/search filters) with cost stripped. */
export async function listPublicProducts(
  filter: Parameters<CatalogRepository["listProducts"]>[0],
): Promise<{ products: PublicProduct[]; total: number; page: number; pageSize: number }> {
  const repo = await tryCatalogRepository();
  if (!repo) return { products: [], total: 0, page: 1, pageSize: filter.pageSize ?? 100 };
  return cachedPublicRead(`public-list:${JSON.stringify(filter)}`, async () => {
    const result = await repo.listProducts({ ...filter, status: "ACTIVE", liveOnly: true });
    return { ...result, products: result.products.map(toPublicProduct) };
  });
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
  return cachedPublicRead("categories", () => repo.getCategories());
}

/**
 * PUBLIC single-product read for the PDP (speed wave): same
 * ACTIVE + publishAt gate as the repository method, TTL-cached.
 * Returns the ADMIN/full shape from the repository (the PDP strips
 * cost via toPublicProduct before anything reaches a client
 * component, exactly as it did with the direct repository call).
 */
export async function getLivePublicProductBySlug(slug: string): Promise<Product | null> {
  const repo = await tryCatalogRepository();
  if (!repo) return null;
  return cachedPublicRead(`public-product:${slug}`, () => repo.getPublicProductBySlug(slug));
}

/**
 * ADMIN edit-form read: one product by id in the full admin shape —
 * variants INCLUDE costPoisha, because the edit form must pre-fill the
 * cost fields. This is a server-component read for staff-only admin
 * pages (the product editor); it must never be used on a public
 * surface. Returns null when the product does not exist (or was
 * soft-deleted) or the DB is not ready — the page renders an honest
 * not-found state, never mock data.
 */
export async function getProductForAdminEdit(id: string): Promise<Product | null> {
  const repo = await tryCatalogRepository();
  if (!repo) return null;
  return repo.getProductById(id);
}

/**
 * Brand names already used by live products, for the editor's brand
 * datalist. The catalog repository has no brand-list method (brands
 * are find-or-create by name inside create/update), so the suggestion
 * set is derived from the products themselves; a merchant can always
 * type a brand-new name and the server will create it.
 */
export async function listBrandNames(): Promise<string[]> {
  const products = await listAllProducts();
  const names = new Set<string>();
  for (const p of products) {
    if (p.brandName) names.add(p.brandName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
