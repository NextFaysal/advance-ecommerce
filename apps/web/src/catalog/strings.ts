/**
 * Unified language system (doc 30) — catalog slice dictionary.
 *
 * Covers the shared storefront catalog components in this folder:
 * ProductCard, QuickView and WishlistToggleButton. Follows the
 * mandatory parity pattern: the `bn` object is written plain (NOT
 * `as const`), `en` is typed as the mapped CatalogStrings type, so a
 * missing/extra key in either locale fails compilation.
 *
 * Words that exist in the shared dictionary (inStock, outOfStock…)
 * are NOT repeated here — components read those from useLocale().t.
 * This file only carries catalog-specific copy.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  wishlistAdd: "উইশলিস্টে যোগ করুন",
  wishlistRemove: "উইশলিস্ট থেকে সরান",
  wishlistIn: "উইশলিস্টে আছে",
  wishlistKeep: "উইশলিস্টে রাখুন",
  ratingLabel: "রেটিং {rating} / ৫",
  priceOnRequest: "দামের জন্য যোগাযোগ করুন",
  quickView: "ঝটপট দেখুন",
  badgeDigital: "ডিজিটাল",
  badgeBundle: "বান্ডল",
  badgePreorder: "প্রি-অর্ডার",
  standardVariant: "স্ট্যান্ডার্ড",
  reviewsCount: "{count}টি রিভিউ",
  variantPickerTitle: "ভেরিয়েন্ট বেছে নিন",
  variantGroupLabel: "ভেরিয়েন্ট",
  soldOutParenthetical: " (স্টক শেষ)",
  viewDetails: "বিস্তারিত দেখুন",
};

export type CatalogStrings = { [K in keyof typeof bn]: string };

const en: CatalogStrings = {
  wishlistAdd: "Add to wishlist",
  wishlistRemove: "Remove from wishlist",
  wishlistIn: "In wishlist",
  wishlistKeep: "Add to wishlist",
  ratingLabel: "Rating {rating} / 5",
  priceOnRequest: "Contact for price",
  quickView: "Quick view",
  badgeDigital: "Digital",
  badgeBundle: "Bundle",
  badgePreorder: "Pre-order",
  standardVariant: "Standard",
  reviewsCount: "{count} reviews",
  variantPickerTitle: "Choose a variant",
  variantGroupLabel: "Variant",
  soldOutParenthetical: " (Out of stock)",
  viewDetails: "View details",
};

export const CATALOG_STRINGS: Record<Locale, CatalogStrings> = { bn, en };
