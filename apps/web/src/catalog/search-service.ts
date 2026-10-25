// Public product search — Meilisearch-first, Postgres fallback, LIVE
// 2026-10-24.
//
// Flow for a text query:
//  1. Ask Meilisearch (short timeout, ids only). It ranks, applies the
//     Banglish synonyms and the unconditional `status = "ACTIVE"`
//     filter.
//  2. HYDRATE the returned ids from Postgres and re-check status
//     there: Postgres is the source of truth, so a stale index
//     document (e.g. a product flipped to DRAFT whose delete has not
//     landed yet) can NEVER surface publicly. Hydration also supplies
//     the full public shape (variants/images, cost already stripped by
//     toPublicProduct) that index documents deliberately do not carry.
//  3. ANY Meilisearch problem (unconfigured, unreachable, timeout,
//     error) degrades to the Postgres path (repository listProducts +
//     applyProductFilter — the pre-Meilisearch behaviour).
//
// The result ALWAYS names the engine that actually answered in
// `engine` ("meilisearch" | "postgres"); routes/pages surface it in
// their meta/UI instead of pretending. Non-query list requests skip
// Meilisearch entirely and are served (and labelled) as Postgres.

import type { CatalogRepository } from "./service";
import { getPublicProducts } from "./service";
import type { ProductFilter } from "./search";
import { searchMeilisearchProducts } from "./indexer";
import { toPublicProduct } from "./types";
import type { PublicProduct } from "./types";

export type SearchEngine = "meilisearch" | "postgres";

export interface PublicSearchResult {
  products: PublicProduct[];
  total: number;
  page: number;
  pageSize: number;
  engine: SearchEngine;
}

export async function searchPublicProducts(
  repo: CatalogRepository,
  filter: ProductFilter & { page?: number; pageSize?: number },
): Promise<PublicSearchResult> {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
  const query = filter.query?.trim() ?? "";

  // Attribute filters (wave 14) live only in Postgres (the Meilisearch
  // document carries no variant attributes), so an attr-filtered
  // request goes straight to the Postgres path below.
  const hasAttributeFilters =
    filter.attributeFilters !== undefined && Object.keys(filter.attributeFilters).length > 0;

  if (query && !hasAttributeFilters) {
    const outcome = await searchMeilisearchProducts({ ...filter, query, page, pageSize });
    if (outcome.ok) {
      // Hydrate in Meilisearch ranking order; drop anything Postgres
      // says is missing or not ACTIVE (the stale-document gate). The
      // wave-14 publishAt gate rides the same check: a scheduled
      // product must not surface through a stale index document.
      const now = Date.now();
      const hydrated: PublicProduct[] = [];
      for (const id of outcome.ids) {
        const product = await repo.getProductById(id);
        if (
          product &&
          product.status === "ACTIVE" &&
          (product.publishAt === null || new Date(product.publishAt).getTime() <= now)
        ) {
          // inStockOnly alignment (doc 17 batch O1): the index's
          // `inStock` boolean is computed at reindex time, but order
          // and POS stock movements do not reindex — a variant sold
          // out since the last reindex would still pass the engine's
          // `inStock = true` clause. Hydration reads the LIVE variant
          // cache from Postgres, so re-check it here and drop what
          // checkout would refuse, exactly as applyProductFilter does
          // on the Postgres path. (The engine `total` still counts
          // every matched document, so a page can come back short —
          // same caveat the stale-status gate above already carries.)
          if (
            filter.inStockOnly &&
            !product.variants.some((v) => v.isActive && v.stock > 0)
          ) {
            continue;
          }
          hydrated.push(toPublicProduct(product));
        }
      }
      return { products: hydrated, total: outcome.total, page, pageSize, engine: "meilisearch" };
    }
    // Fall through to Postgres on any Meilisearch failure — search
    // availability never depends on the search engine being up.
  }

  const fallback = await getPublicProducts(repo, { ...filter, page, pageSize });
  return { ...fallback, engine: "postgres" };
}
