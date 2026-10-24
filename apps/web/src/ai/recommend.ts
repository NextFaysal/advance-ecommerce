/**
 * Related-products recommendation — Agent 15, Step 47 (A3).
 * PURE SCORING, no ML: points for same category, shared tags, similar
 * price band, and existing rating. The score breakdown is returned per
 * item so staff/customers are never told a black-box "AI picked this".
 *
 * Scoring: same category +50, each shared tag +15 (max +45),
 * price within ±25% of source min price +20, ±50% +10,
 * rating >= 4.0 +10. Inactive / self / archived are excluded.
 */
import type { Product } from "../catalog/types";
import { minVariantPricePoisha } from "../catalog/types";

export interface Recommendation {
  productId: string;
  slug: string;
  score: number;
  reasons: string[];
}

export function relatedProducts(source: Product, all: Product[], limit = 8): Recommendation[] {
  const sourcePrice = minVariantPricePoisha(source);
  const sourceTags = new Set(source.tags.map((t) => t.toLowerCase()));

  const scored: Recommendation[] = [];
  for (const candidate of all) {
    if (candidate.id === source.id || candidate.status !== "ACTIVE") continue;
    let score = 0;
    const reasons: string[] = [];
    if (candidate.categorySlug === source.categorySlug) { score += 50; reasons.push("same-category"); }
    const sharedTags = candidate.tags.filter((t) => sourceTags.has(t.toLowerCase()));
    if (sharedTags.length > 0) {
      score += Math.min(45, sharedTags.length * 15);
      reasons.push(`shared-tags:${sharedTags.slice(0, 3).join(",")}`);
    }
    const price = minVariantPricePoisha(candidate);
    if (sourcePrice > 0 && price > 0) {
      const ratio = Math.abs(price - sourcePrice) / sourcePrice;
      if (ratio <= 0.25) { score += 20; reasons.push("similar-price"); }
      else if (ratio <= 0.5) { score += 10; reasons.push("near-price"); }
    }
    if (candidate.ratingAverage !== null && candidate.ratingAverage >= 4) { score += 10; reasons.push("highly-rated"); }
    if (score > 0) scored.push({ productId: candidate.id, slug: candidate.slug, score, reasons });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}
