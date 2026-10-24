// Meilisearch indexer + search client — Step 10 wiring, made LIVE
// 2026-10-24. Talks to a real Meilisearch over HTTP using
// MEILISEARCH_HOST / MEILISEARCH_API_KEY from the runtime env only
// (no SDK dependency, no key hardcoded; host placeholder in
// .env.example is http://localhost:7700).
//
// Behaviour contract:
//  - Every function is best-effort and NEVER throws: when Meilisearch
//    is unconfigured or unreachable, writes return { skipped } /
//    { ok: false } and searches return { ok: false } so callers can
//    degrade to the Postgres fallback WITHOUT failing a product save
//    or a storefront search.
//  - PUBLIC INDEX INVARIANT: only ACTIVE products are ever written to
//    the "products" index. indexProduct() on a DRAFT/ARCHIVED product
//    DELETES its document instead, so a status flip away from ACTIVE
//    removes it. Documents also carry `status` (filterable) and every
//    public search filters `status = ACTIVE` — and the search service
//    still re-checks status in Postgres during hydration, so a stale
//    document can never surface a non-ACTIVE product.
//  - Documents NEVER contain costPoisha (see toMeilisearchDocument —
//    it maps the fixed MeilisearchProductDocument shape only).

import type { Product } from "./types";
import { minVariantPricePoisha, maxVariantPricePoisha } from "./types";
import type { MeilisearchProductDocument, ProductFilter } from "./search";
import { BANGLISH_SYNONYMS, PRODUCTS_INDEX_CONFIG } from "./search";

export const PRODUCTS_INDEX_UID = "products";

export function toMeilisearchDocument(product: Product): MeilisearchProductDocument {
  return {
    id: product.id,
    slug: product.slug,
    status: product.status,
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

interface MeiliConfig {
  host: string;
  apiKey: string;
}

function meiliConfig(): MeiliConfig | null {
  const host = (process.env.MEILISEARCH_HOST ?? "").replace(/\/+$/, "");
  const apiKey = process.env.MEILISEARCH_API_KEY ?? "";
  if (!host || !apiKey) return null;
  return { host, apiKey };
}

/** Indexing/settings calls get a few seconds; a hung Meilisearch must
 *  never hang a product save or the reindex script. */
const INDEX_TIMEOUT_MS = 5_000;
/** Public search must degrade to Postgres FAST when Meilisearch is ill. */
export const SEARCH_TIMEOUT_MS = 800;

interface MeiliResponse {
  status: number;
  json: unknown;
}

async function meiliRequest(
  path: string,
  method: string,
  body: unknown,
  timeoutMs: number,
): Promise<MeiliResponse> {
  const config = meiliConfig();
  if (!config) throw new Error("MEILISEARCH_HOST or MEILISEARCH_API_KEY not set");
  const res = await fetch(`${config.host}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await res.json().catch(() => null)) as unknown;
  return { status: res.status, json };
}

function taskUidOf(json: unknown): number | null {
  if (typeof json === "object" && json !== null && "taskUid" in json) {
    const uid = (json as { taskUid?: unknown }).taskUid;
    return typeof uid === "number" ? uid : null;
  }
  return null;
}

/** Poll a Meilisearch task until it succeeds/fails (bounded). Indexing
 *  is asynchronous on the server; scripts and settings application
 *  wait so their results are deterministic. */
async function waitForTask(taskUid: number, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { status, json } = await meiliRequest(`/tasks/${taskUid}`, "GET", undefined, INDEX_TIMEOUT_MS);
      if (status === 200 && typeof json === "object" && json !== null && "status" in json) {
        const taskStatus = (json as { status?: unknown }).status;
        if (taskStatus === "succeeded") return true;
        if (taskStatus === "failed" || taskStatus === "canceled") return false;
      }
    } catch {
      // Transient read failure — keep polling until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function meiliMutate(path: string, method: string, body: unknown, wait: boolean): Promise<IndexResult> {
  if (!meiliConfig()) {
    return { ok: false, skipped: true, reason: "MEILISEARCH_HOST or MEILISEARCH_API_KEY not set — indexing skipped, product save unaffected" };
  }
  try {
    const { status, json } = await meiliRequest(path, method, body, INDEX_TIMEOUT_MS);
    if (status < 200 || status >= 300) {
      return { ok: false, skipped: false, reason: `Meilisearch ${status}: ${JSON.stringify(json)?.slice(0, 200) ?? ""}` };
    }
    if (wait) {
      const uid = taskUidOf(json);
      if (uid !== null && !(await waitForTask(uid))) {
        return { ok: false, skipped: false, reason: `Meilisearch task ${uid} did not succeed` };
      }
    }
    return { ok: true, skipped: false };
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "Meilisearch request failed" };
  }
}

/** Ensure the products index exists (idempotent — "already exists" is success). */
export async function ensureProductsIndex(): Promise<IndexResult> {
  if (!meiliConfig()) return { ok: false, skipped: true, reason: "Meilisearch not configured" };
  try {
    const { status, json } = await meiliRequest("/indexes", "POST", {
      uid: PRODUCTS_INDEX_UID,
      primaryKey: PRODUCTS_INDEX_CONFIG.primaryKey,
    }, INDEX_TIMEOUT_MS);
    if (status >= 200 && status < 300) {
      const uid = taskUidOf(json);
      if (uid !== null) await waitForTask(uid);
      return { ok: true, skipped: false };
    }
    const message =
      typeof json === "object" && json !== null && "message" in json
        ? String((json as { message?: unknown }).message ?? "")
        : "";
    if (message.includes("already exists")) return { ok: true, skipped: false };
    return { ok: false, skipped: false, reason: `Meilisearch ${status}: ${message}` };
  } catch (error) {
    return { ok: false, skipped: false, reason: error instanceof Error ? error.message : "Index create failed" };
  }
}

/**
 * Best-effort: sync one product into the public index. ACTIVE products
 * are upserted; DRAFT/ARCHIVED products are REMOVED (the public index
 * only ever holds the ACTIVE set). Never throws.
 */
export async function indexProduct(product: Product): Promise<IndexResult> {
  if (product.status !== "ACTIVE") {
    return deleteProductFromIndex(product.id);
  }
  return meiliMutate(
    `/indexes/${PRODUCTS_INDEX_UID}/documents?primaryKey=${PRODUCTS_INDEX_CONFIG.primaryKey}`,
    "PUT",
    [toMeilisearchDocument(product)],
    false,
  );
}

export async function deleteProductFromIndex(productId: string): Promise<IndexResult> {
  return meiliMutate(
    `/indexes/${PRODUCTS_INDEX_UID}/documents/${encodeURIComponent(productId)}`,
    "DELETE",
    undefined,
    false,
  );
}

/**
 * Repository-layer removal hook for product deletion: fire-and-forget
 * wrapper around deleteProductFromIndex with the same failure contract
 * as syncProductSearchIndex (log, never fail the catalog write).
 */
export function removeProductFromSearchIndex(productId: string): void {
  void deleteProductFromIndex(productId)
    .then((result) => {
      if (!result.ok && !result.skipped) {
        console.error(
          `[search-index] delete failed for product ${productId}: ${result.reason ?? "unknown"}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(
        `[search-index] delete error for product ${productId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/**
 * Repository-layer sync hook: fire-and-forget wrapper around
 * indexProduct with failure logging. A Meilisearch outage must never
 * fail (or even slow down) a catalog write — failures are logged and
 * the reindex script is the recovery path.
 */
export function syncProductSearchIndex(product: Product): void {
  void indexProduct(product)
    .then((result) => {
      if (!result.ok && !result.skipped) {
        console.error(
          `[search-index] sync failed for product ${product.id} (${product.slug}): ${result.reason ?? "unknown"}`,
        );
      }
    })
    .catch((error: unknown) => {
      console.error(
        `[search-index] sync error for product ${product.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

/** Apply index settings + synonyms (idempotent). Waits for the tasks
 *  so callers (reindex script) observe the settings as live. */
export async function applyIndexSettings(): Promise<IndexResult> {
  const ensured = await ensureProductsIndex();
  if (!ensured.ok) return ensured;
  const settings = buildIndexSettings();
  const res = await meiliMutate(`/indexes/${PRODUCTS_INDEX_UID}/settings`, "PATCH", {
    searchableAttributes: settings.searchableAttributes,
    filterableAttributes: settings.filterableAttributes,
    sortableAttributes: settings.sortableAttributes,
    typoTolerance: settings.typoTolerance,
  }, true);
  if (!res.ok) return res;
  return meiliMutate(`/indexes/${PRODUCTS_INDEX_UID}/settings/synonyms`, "PUT", settings.synonyms, true);
}

/** Remove every document from the products index (reindex step). */
export async function clearProductDocuments(): Promise<IndexResult> {
  return meiliMutate(`/indexes/${PRODUCTS_INDEX_UID}/documents`, "DELETE", undefined, true);
}

/** Add/replace a batch of documents and wait for indexing to finish. */
export async function addProductDocuments(documents: MeilisearchProductDocument[]): Promise<IndexResult> {
  if (documents.length === 0) return { ok: true, skipped: false };
  return meiliMutate(
    `/indexes/${PRODUCTS_INDEX_UID}/documents?primaryKey=${PRODUCTS_INDEX_CONFIG.primaryKey}`,
    "PUT",
    documents,
    true,
  );
}

/** Live document count of the products index, or null when unreachable. */
export async function getProductDocumentCount(): Promise<number | null> {
  if (!meiliConfig()) return null;
  try {
    const { status, json } = await meiliRequest(`/indexes/${PRODUCTS_INDEX_UID}/stats`, "GET", undefined, INDEX_TIMEOUT_MS);
    if (status !== 200 || typeof json !== "object" || json === null) return null;
    const count = (json as { numberOfDocuments?: unknown }).numberOfDocuments;
    return typeof count === "number" ? count : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public search
// ---------------------------------------------------------------------------

export interface MeilisearchSearchOutcome {
  ok: boolean;
  /** Ordered product ids (Meilisearch ranking) for the requested page. */
  ids: string[];
  /** Engine-reported total hits across all pages. */
  total: number;
  reason?: string;
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSearchFilter(filter: ProductFilter): string[] {
  // The public index must NEVER return a non-ACTIVE product — this
  // filter is unconditional, not derived from caller input.
  const clauses: string[] = ['status = "ACTIVE"'];
  if (filter.categorySlug) clauses.push(`categorySlug = "${escapeFilterValue(filter.categorySlug)}"`);
  if (filter.brandName) clauses.push(`brandName = "${escapeFilterValue(filter.brandName)}"`);
  if (filter.inStockOnly) clauses.push("inStock = true");
  if (filter.minPricePoisha !== undefined) clauses.push(`maxPricePoisha >= ${Math.trunc(filter.minPricePoisha)}`);
  if (filter.maxPricePoisha !== undefined) clauses.push(`minPricePoisha <= ${Math.trunc(filter.maxPricePoisha)}`);
  return clauses;
}

function buildSearchSort(sort: ProductFilter["sort"]): string[] | undefined {
  switch (sort) {
    case "price-asc":
      return ["minPricePoisha:asc"];
    case "price-desc":
      return ["minPricePoisha:desc"];
    case "rating":
      return ["ratingAverage:desc"];
    case "newest":
      return ["createdAt:desc"];
    default:
      return undefined;
  }
}

/**
 * Query Meilisearch for a page of product ids. Returns { ok: false }
 * on ANY problem (unconfigured, unreachable, timeout, bad status) so
 * the caller degrades to Postgres — search availability never depends
 * on Meilisearch being up. Only ids are retrieved: full product data
 * (and the final ACTIVE gate) comes from Postgres hydration.
 */
export async function searchMeilisearchProducts(
  filter: ProductFilter & { page?: number; pageSize?: number },
): Promise<MeilisearchSearchOutcome> {
  if (!meiliConfig()) return { ok: false, ids: [], total: 0, reason: "Meilisearch not configured" };
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, filter.pageSize ?? 20));
  try {
    const { status, json } = await meiliRequest(`/indexes/${PRODUCTS_INDEX_UID}/search`, "POST", {
      q: filter.query ?? "",
      filter: buildSearchFilter(filter),
      sort: buildSearchSort(filter.sort),
      limit: pageSize,
      offset: (page - 1) * pageSize,
      attributesToRetrieve: ["id"],
    }, SEARCH_TIMEOUT_MS);
    if (status !== 200 || typeof json !== "object" || json === null) {
      return { ok: false, ids: [], total: 0, reason: `Meilisearch search ${status}` };
    }
    const body = json as { hits?: unknown; estimatedTotalHits?: unknown; totalHits?: unknown };
    const hits = Array.isArray(body.hits) ? body.hits : [];
    const ids: string[] = [];
    for (const hit of hits) {
      if (typeof hit === "object" && hit !== null && "id" in hit) {
        const id = (hit as { id?: unknown }).id;
        if (typeof id === "string") ids.push(id);
      }
    }
    const total =
      typeof body.estimatedTotalHits === "number"
        ? body.estimatedTotalHits
        : typeof body.totalHits === "number"
          ? body.totalHits
          : ids.length;
    return { ok: true, ids, total };
  } catch (error) {
    return {
      ok: false,
      ids: [],
      total: 0,
      reason: error instanceof Error ? error.message : "Meilisearch search failed",
    };
  }
}
