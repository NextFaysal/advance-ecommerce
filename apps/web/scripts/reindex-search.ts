/**
 * Full Meilisearch reindex — Step 10 live wiring, 2026-10-24.
 *
 * Rebuilds the public "products" index from the Prisma catalog:
 *   1. ensure the index exists,
 *   2. apply the Step-10 settings + Banglish synonyms (indexer.ts),
 *   3. delete ALL existing documents (drops stale docs of products
 *      that were deleted or flipped away from ACTIVE),
 *   4. add documents for every ACTIVE, non-deleted product.
 *
 * Only ACTIVE products are indexed — DRAFT/ARCHIVED never enter the
 * public index (documents also carry `status`, queries filter on it,
 * and search hydration re-checks Postgres — three gates total).
 * Documents never contain costPoisha.
 *
 * Idempotent: safe to re-run at any time; it is also the recovery
 * path when an incremental sync was missed (e.g. Meilisearch was
 * down during a product save).
 *
 * Run (from apps/web):
 *   DATABASE_URL=postgresql://... \
 *   MEILISEARCH_HOST=http://127.0.0.1:7700 \
 *   MEILISEARCH_API_KEY=<master-or-admin-key> \
 *     ./node_modules/.bin/tsx scripts/reindex-search.ts
 * Exits non-zero on any failure.
 */
import { prisma } from "@advance-ecommerce/db";
import { PrismaCatalogRepository, hasPrismaCatalog } from "../src/catalog/service";
import {
  addProductDocuments,
  applyIndexSettings,
  clearProductDocuments,
  getProductDocumentCount,
  toMeilisearchDocument,
} from "../src/catalog/indexer";
import type { MeilisearchProductDocument } from "../src/catalog/search";

const BATCH_SIZE = 100;

async function main(): Promise<void> {
  if (!hasPrismaCatalog(prisma)) {
    throw new Error("Prisma client has no catalog delegates — run prisma generate first.");
  }
  const repo = new PrismaCatalogRepository(prisma);

  console.log("[reindex] applying index settings + synonyms…");
  const settings = await applyIndexSettings();
  if (!settings.ok) {
    throw new Error(`applyIndexSettings failed: ${settings.reason ?? "unknown"} (skipped=${settings.skipped})`);
  }

  console.log("[reindex] clearing existing documents…");
  const cleared = await clearProductDocuments();
  if (!cleared.ok) {
    throw new Error(`clearProductDocuments failed: ${cleared.reason ?? "unknown"}`);
  }

  let page = 1;
  let indexed = 0;
  let dbActiveTotal: number | null = null;
  for (;;) {
    const result = await repo.listProducts({ status: "ACTIVE", page, pageSize: BATCH_SIZE });
    dbActiveTotal = result.total;
    const documents: MeilisearchProductDocument[] = result.products
      // listProducts already filters ACTIVE + non-deleted; the status
      // re-check keeps the index invariant local to this script too.
      .filter((p) => p.status === "ACTIVE")
      .map(toMeilisearchDocument);
    if (documents.length > 0) {
      const added = await addProductDocuments(documents);
      if (!added.ok) {
        throw new Error(`addProductDocuments failed on page ${page}: ${added.reason ?? "unknown"}`);
      }
      indexed += documents.length;
    }
    if (page * BATCH_SIZE >= result.total) break;
    page += 1;
  }

  const indexCount = await getProductDocumentCount();
  console.log(
    `[reindex] done: DB ACTIVE products=${dbActiveTotal ?? "?"}, documents sent=${indexed}, index document count=${indexCount ?? "?"}`,
  );
  if (indexCount !== null && dbActiveTotal !== null && indexCount !== dbActiveTotal) {
    throw new Error(`document count mismatch: index=${indexCount}, DB ACTIVE=${dbActiveTotal}`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (error: unknown) => {
    console.error("[reindex] FAILED:", error instanceof Error ? error.message : error);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
