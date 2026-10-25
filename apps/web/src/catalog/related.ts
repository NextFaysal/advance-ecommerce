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
import { tryCatalogRepository } from "./server-read";
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

  // 1) Manual picks, in order.
  for (const id of product.relatedIds ?? []) {
    if (out.length >= limit) break;
    if (seen.has(id)) continue;
    seen.add(id);
    const picked = await repo.getProductById(id).catch(() => null);
    if (picked && isLive(picked)) out.push(toPublicProduct(picked));
  }

  // 2) Same-category best-rated fill.
  if (out.length < limit) {
    const fill = await repo
      .listProducts({
        status: "ACTIVE",
        categorySlug: product.categorySlug,
        sort: "rating",
        page: 1,
        // Over-fetch: some rows are the product itself or manual picks.
        pageSize: Math.min(100, limit + seen.size + 4),
      })
      .catch(() => null);
    for (const candidate of fill?.products ?? []) {
      if (out.length >= limit) break;
      if (seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      out.push(toPublicProduct(candidate));
    }
  }

  return out;
}
