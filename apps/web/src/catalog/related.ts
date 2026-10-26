/**
 * Related products — PDP "সম্পর্কিত পণ্য" rail resolution (Wave 14-2,
 * doc 16 §P6 merchandising).
 *
 * Resolution order:
 *   1. The product's MANUAL picks (`relatedIds`, set from the admin
 *      related-picker below the product editor), in the merchant's
 *      order. Each pick must still be storefront-live: ACTIVE status
 *      and past its `publishAt` gate — a pick that was later drafted,
 *      archived, soft-deleted or scheduled into the future drops out
 *      silently rather than leaking a dead PDP link.
 *   2. Fallback fill: same-category, best-rated ACTIVE products from
 *      the repository list (which applies the same publish gate at
 *      the service layer), excluding the product itself and anything
 *      already picked manually.
 *
 * The result is capped at RELATED_LIMIT (8) and always PUBLIC-shaped
 * (costPoisha stripped via toPublicProduct) — this helper feeds a
 * public page, so the admin shape must never pass through.
 */
import { listPublicProducts, tryCatalogRepository } from "./server-read";
import type { Product, PublicProduct } from "./types";
import { toPublicProduct } from "./types";

export const RELATED_LIMIT = 8;

/** Storefront-live check for a full-shape product fetched by id. */
function isLive(product: Product): boolean {
  if (product.status !== "ACTIVE") return false;
  if (product.publishAt) {
    const at = new Date(product.publishAt).getTime();
    if (Number.isFinite(at) && at > Date.now()) return false;
  }
  return true;
}

export async function getRelatedProducts(
  product: Pick<Product, "id" | "categorySlug" | "relatedIds">,
  limit = RELATED_LIMIT,
): Promise<PublicProduct[]> {
  const repo = await tryCatalogRepository();
  if (!repo) return [];

  const out: PublicProduct[] = [];
  const seen = new Set<string>([product.id]);

  // 1) Manual picks, in order. Speed wave batch 2: the per-pick
  // fetches run in parallel (was one serial await per pick); the
  // walk below re-applies the merchant's order, the seen/limit
  // bookkeeping and the live check exactly as the serial loop did.
  const pickIds: string[] = [];
  for (const id of product.relatedIds ?? []) {
    if (!seen.has(id) && !pickIds.includes(id)) pickIds.push(id);
  }
  const picks = await Promise.all(pickIds.map((id) => repo.getProductById(id).catch(() => null)));
  for (let i = 0; i < pickIds.length; i++) {
    if (out.length >= limit) break;
    seen.add(pickIds[i]);
    const picked = picks[i];
    if (picked && isLive(picked)) out.push(toPublicProduct(picked));
  }

  // 2) Same-category best-rated fill. Batch 2: served through the
  // TTL-cached public list in server-read instead of a raw
  // repository call — same semantics (ACTIVE only, publishAt gate
  // via liveOnly, same category + rating sort + over-fetch window),
  // and the rows arrive already PUBLIC-shaped, so they are pushed
  // as-is (no second toPublicProduct pass).
  if (out.length < limit) {
    const fill = await listPublicProducts({
      categorySlug: product.categorySlug,
      sort: "rating",
      page: 1,
      // Over-fetch: some rows are the product itself or manual picks.
      pageSize: Math.min(100, limit + seen.size + 4),
    }).catch(() => null);
    for (const candidate of fill?.products ?? []) {
      if (out.length >= limit) break;
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(candidate);
    }
  }

  return out;
}
