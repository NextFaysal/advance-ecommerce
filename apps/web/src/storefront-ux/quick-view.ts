/**
 * Quick-view data builder — Part B. Pure: turns a PublicProduct (cost
 * already stripped by toPublicProduct) into exactly what the quick-view
 * modal renders, so the modal never touches catalog internals.
 */
import type { PublicProduct } from "@/catalog/types";
import { pick, type Locale } from "@/i18n/locale";
import type { QuickViewData } from "./types";

/** Fallback label for a variant with no attributes (doc 30: locale-aware). */
const STANDARD_VARIANT_LABEL: Record<Locale, string> = { bn: "স্ট্যান্ডার্ড", en: "Standard" };

/** Poisha range across active variants of a PUBLIC product (no cost fields). */
export function publicPriceRangePoisha(product: PublicProduct): { min: number; max: number } {
  const prices = product.variants.filter((v) => v.isActive).map((v) => v.pricePoisha);
  if (prices.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function buildQuickViewData(product: PublicProduct, locale: Locale = "bn"): QuickViewData {
  const activeVariants = product.variants.filter((v) => v.isActive);
  const firstImage = [...product.images].sort((a, b) => a.sortOrder - b.sortOrder)[0];
  return {
    productId: product.id,
    slug: product.slug,
    titleBn: product.title.bn,
    titleEn: product.title.en,
    descriptionBn: product.description.bn,
    descriptionEn: product.description.en,
    imageUrl: firstImage?.url ?? null,
    brandName: product.brandName,
    minPricePoisha: publicPriceRangePoisha(product).min,
    maxPricePoisha: publicPriceRangePoisha(product).max,
    variants: activeVariants.map((v) => ({
      variantId: v.id,
      label: Object.values(v.attributes).join(" / ") || pick(locale, STANDARD_VARIANT_LABEL),
      pricePoisha: v.pricePoisha,
      stock: v.stock,
      inStock: v.stock > 0,
    })),
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
    inStock: activeVariants.some((v) => v.stock > 0),
    hasSizeGuide: product.categorySlug === "fashion",
  };
}
