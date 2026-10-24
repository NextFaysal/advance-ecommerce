// Meilisearch indexer — Agent 8 (Step 10 contract, search.ts).
// No real Meilisearch call is made with a real key by this module's
// callers in this slice: indexDocument() reads MEILISEARCH_HOST /
// MEILISEARCH_API_KEY from the runtime env only, and returns
// { skipped: true } when either is missing — so local dev without
// Meilisearch never fails a product save. The host is a placeholder
// in .env.example (http://localhost:7700); no key is hardcoded here.

import type { Product } from "./types";
import { minVariantPricePoisha, maxVariantPricePoisha } from "./types";
import type { MeilisearchProductDocument } from "./search";
import { BANGLISH_SYNONYMS, PRODUCTS_INDEX_CONFIG } from "./search";

export function toMeilisearchDocument(product: Product): MeilisearchProductDocument {
  return {
    id: product.id,
    slug: product.slug,
    titleBn: product.title.bn,
    titleEn: product.title.en,
    descriptionBn: product.description.bn,
    descriptionEn: product.description.en,
    categorySlug: product.categorySlug,
    brandName: product.brandName,
    tags: product.tags,
    minPricePoisha: minVariantPricePoisha(product),
    maxPricePoisha: maxVariantPricePoisha(product),
    inStock: product.variants.some((v) => v.isActive && v.stock > 0),
    ratingAverage: product.ratingAverage,
    createdAt: product.createdAt,
  };
}

/** Flatten BANGLISH_SYNONYMS to Meilisearch's synonyms format. */
export function buildSynonymsPayload(): Record<string, string[]> {
  return { ...BANGLISH_SYNONYMS };
}

export function buildIndexSettings(): {
  searchableAttributes: readonly string[];
  filterableAttributes: readonly string[];
  sortableAttributes: readonly string[];
  typoTolerance: unknown;
  synonyms: Record<string, string[]>;
} {
  return {
    searchableAttributes: PRODUCTS_INDEX_CONFIG.searchableAttributes,
    filterableAttributes: PRODUCTS_INDEX_CONFIG.filterableAttributes,
    sortableAttributes: PRODUCTS_INDEX_CONFIG.sortableAttributes,
    typoTolerance: PRODUCTS_INDEX_CONFIG.typoTolerance,
    synonyms: buildSynonymsPayload(),
  };
}

export interface IndexResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

async function meiliFetch(path: string, method: string, body: unknown): Promise<IndexResult> {
  const host = (process.env.MEILISEARCH_HOST ?? "").replace(/\/+$/, "");
  const apiKey = process.env.MEILISEARCH_API_KEY ?? "";
  if (!host || !apiKey) return { ok: false, skipped: true, reason: "MEILISEARCH_HOST or MEILISEARCH_API_KEY not set — indexing skipped, product save unaffected" };
  const res = await fetch(`${host}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, skipped: false, reason: `Meilisearch ${res.status}` };
  return { ok: true, skipped: false };
}

/** Best-effort: index one product. Never throws — callers log, never fail a save. */
export async function indexProduct(product: Product): Promise<IndexResult> {
  try {
    return await meiliFetch("/indexes/products/documents?primaryKey=id", "PUT", [toMeilisearchDocument(product)]);
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "Index failed" };
  }
}

export async function deleteProductFromIndex(productId: string): Promise<IndexResult> {
  try {
    return await meiliFetch(`/indexes/products/documents/${encodeURIComponent(productId)}`, "DELETE", undefined);
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "Index delete failed" };
  }
}

/** One-time setup outline: apply index settings + synonyms. Run from a CLI/job, not on every save. */
export async function applyIndexSettings(): Promise<IndexResult> {
  try {
    const settings = buildIndexSettings();
    const res = await meiliFetch("/indexes/products/settings", "PATCH", {
      searchableAttributes: settings.searchableAttributes,
      filterableAttributes: settings.filterableAttributes,
      sortableAttributes: settings.sortableAttributes,
      typoTolerance: settings.typoTolerance,
    });
    if (!res.ok || res.skipped) return res;
    return await meiliFetch("/indexes/products/settings/synonyms", "PUT", settings.synonyms);
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "Index settings failed" };
  }
}
