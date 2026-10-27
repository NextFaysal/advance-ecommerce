/**
 * Unified language system (doc 30) — storefront (store) slice dictionary.
 *
 * One shared dictionary for the app/(store) pages in this slice:
 * shop (ShopBrowser + MobileFilterDrawer), search (SearchBrowser),
 * wishlist and compare. Follows the mandatory parity pattern: the
 * `bn` object is written plain (NOT `as const`), `en` is typed as
 * the mapped StoreStrings type, so a missing/extra key in either
 * locale fails compilation.
 *
 * Words that exist in the shared dictionary (allProducts, search,
 * loading…) are NOT repeated here — components read those from
 * useLocale().t. This file only carries page-specific copy.
 * Templates use `{name}` placeholders via interpolate().
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // ShopBrowser
  shopDefaultTitle: "দোকান — Advance Ecommerce",
  categoryFallbackTitle: "{name} — Advance Ecommerce",
  searchResultsHeading: "“{q}” — অনুসন্ধানের ফলাফল",
  searchChip: "খোঁজ: {q}",
  inStockOnlyChip: "শুধু স্টকে আছে",
  ratingChip: "{rating}★ ও উপরে",
  priceMaxLabel: "সর্বোচ্চ",
  priceZeroLabel: "৳০",
  emptySearchTitle: "“{q}” দিয়ে কোনো পণ্য পাওয়া যায়নি",
  emptySearchDescription:
    "বানান ঠিক আছে কিনা দেখুন, অথবা অন্য কোনো নামে খুঁজে দেখুন। চাইলে সব পণ্য ঘুরে দেখতে পারেন।",
  emptySearchCta: "সব পণ্য দেখুন",
  emptyFilterTitle: "এই ফিল্টারে কোনো পণ্য মিলছে না",
  emptyFilterDescription:
    "নির্বাচিত ফিল্টারের সাথে মিলে এমন পণ্য এখন স্টকে নেই। ফিল্টার বদলে বা মুছে আবার দেখুন।",
  emptyFilterCta: "সব ফিল্টার মুছুন",
  emptyCatalogTitle: "এখনো কোনো পণ্য যোগ হয়নি",
  emptyCatalogDescription:
    "আমাদের কালেকশন তৈরি হচ্ছে — খুব শীঘ্রই নতুন পণ্য আসছে। ততক্ষণে হোমপেজে ঘুরে দেখুন।",
  emptyCatalogCta: "হোমপেজে যান",

  // MobileFilterDrawer
  filter: "ফিল্টার",
  clearAll: "সব মুছুন",
  viewResults: "ফলাফল দেখুন ({count}টি পণ্য)",

  // SearchBrowser
  searchResultsFor: "“{q}” এর ফলাফল",
  searchHeadingDefault: "পণ্য খুঁজুন",
  searchPlaceholder: "যেমন: জামা, sharee, charger…",
  searchMappedPrefix: "খুঁজছেন:",
  searchMappedItem: "{to} ({from}-এর জন্য)",
  searchIdleHint: "উপরে শব্দ লিখে খুঁজুন — বাংলা বা Banglish, দুটোই চলবে।",
  searchLoading: "খুঁজছি…",
  searchErrorPrefix: "খুঁজতে সমস্যা হয়েছে — একটু পরে আবার চেষ্টা করুন, অথবা",
  searchErrorSuffix: "দেখুন।",
  searchNoResultsPrefix: "“{q}” দিয়ে কিছু পাওয়া যায়নি। বানান দেখে আবার চেষ্টা করুন বা",
  searchNoResultsSuffix: "দেখুন।",
  engineMeilisearch: "Search engine: Meilisearch (typo-tolerant, বাংলা + Banglish synonyms)।",
  enginePostgres: "Search engine: PostgreSQL (fallback — Meilisearch unavailable)।",
  engineDefault:
    "Typo-tolerant search: Meilisearch (বাংলা + Banglish synonyms), না থাকলে PostgreSQL fallback।",

  // Wishlist page
  wishlistHeading: "আমার পছন্দের তালিকা",
  wishlistNote:
    "পণ্যের তথ্য আসল ক্যাটালগ থেকে আসে; পছন্দের তালিকা শুধু এই ব্রাউজারেই সংরক্ষিত থাকে।",
  wishlistEmptyTitle: "আপনার পছন্দের তালিকা খালি",
  wishlistEmptyDescription: "পছন্দের পণ্যে হার্ট চিহ্ন চাপলেই এখানে যোগ হবে।",
  startShopping: "কেনাকাটা শুরু করুন",
  priceFrom: "{price} থেকে",
  removeFromList: "তালিকা থেকে সরান",

  // Compare page
  compareHeading: "পণ্য তুলনা",
  compareNote: "পণ্যের তথ্য আসল ক্যাটালগ থেকে আসে; তুলনার তালিকা এই ব্রাউজারেই থাকে।",
  compareEmptyTitle: "তুলনায় কোনো পণ্য নেই",
  compareEmptyDescription:
    "পণ্যের পেজে 'তুলনা করুন' চাপলে এখানে পাশাপাশি তুলনা দেখা যাবে (সর্বোচ্চ ৩টি)।",
  featureColumn: "বৈশিষ্ট্য",
  removeShort: "সরান",
  differingBadge: "পার্থক্য",

  // Server-page metadata + home hero stats (store-default locale —
  // these surfaces are ISR/static, so they follow the store default,
  // not the per-visitor cookie; see doc 30 resolution rules).
  shopMetaDescription: "সব পণ্য — ফিল্টার, সর্ট ও সার্চ দিয়ে খুঁজুন।",
  searchMetaTitle: "Search — Advance Ecommerce",
  searchMetaDescription: "পণ্য খুঁজুন — বাংলা ও Banglish দুটোতেই।",
  homeMetaTitle: "Advance Ecommerce — বাংলাদেশের অনলাইন শপ",
  homeMetaDescription: "ফ্যাশন, ইলেকট্রনিক্স ও আরও অনেক কিছু — সারাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি।",
  homeOgDescription: "বাংলাদেশের অনলাইন শপ — হোম ডেলিভারি, COD।",
  homeStatProducts: "পণ্যের কালেকশন",
  homeStatCategories: "ক্যাটাগরি",
  homeStatDistricts: "জেলায় হোম ডেলিভারি",
};

export type StoreStrings = { [K in keyof typeof bn]: string };

const en: StoreStrings = {
  // ShopBrowser
  shopDefaultTitle: "Shop — Advance Ecommerce",
  categoryFallbackTitle: "{name} — Advance Ecommerce",
  searchResultsHeading: "“{q}” — Search results",
  searchChip: "Search: {q}",
  inStockOnlyChip: "In stock only",
  ratingChip: "{rating}★ & up",
  priceMaxLabel: "Max",
  priceZeroLabel: "৳0",
  emptySearchTitle: "No products found for “{q}”",
  emptySearchDescription:
    "Check the spelling, or try searching by a different name. You can also browse all products.",
  emptySearchCta: "View all products",
  emptyFilterTitle: "No products match these filters",
  emptyFilterDescription:
    "No product currently in stock matches the selected filters. Try changing or clearing the filters.",
  emptyFilterCta: "Clear all filters",
  emptyCatalogTitle: "No products added yet",
  emptyCatalogDescription:
    "Our collection is being prepared — new products are coming very soon. In the meantime, take a look around the homepage.",
  emptyCatalogCta: "Go to homepage",

  // MobileFilterDrawer
  filter: "Filter",
  clearAll: "Clear all",
  viewResults: "View results ({count} products)",

  // SearchBrowser
  searchResultsFor: "Results for “{q}”",
  searchHeadingDefault: "Search products",
  searchPlaceholder: "e.g. shirt, sharee, charger…",
  searchMappedPrefix: "Searching for:",
  searchMappedItem: "{to} (for {from})",
  searchIdleHint: "Type a word above to search — Bangla or Banglish, both work.",
  searchLoading: "Searching…",
  searchErrorPrefix: "Something went wrong while searching — please try again shortly, or browse",
  searchErrorSuffix: ".",
  searchNoResultsPrefix: "Nothing found for “{q}”. Check the spelling and try again, or browse",
  searchNoResultsSuffix: ".",
  engineMeilisearch: "Search engine: Meilisearch (typo-tolerant, Bangla + Banglish synonyms).",
  enginePostgres: "Search engine: PostgreSQL (fallback — Meilisearch unavailable).",
  engineDefault:
    "Typo-tolerant search: Meilisearch (Bangla + Banglish synonyms), with PostgreSQL fallback if unavailable.",

  // Wishlist page
  wishlistHeading: "My Wishlist",
  wishlistNote:
    "Product information comes from the real catalogue; your wishlist is stored only in this browser.",
  wishlistEmptyTitle: "Your wishlist is empty",
  wishlistEmptyDescription: "Tap the heart icon on a product you like and it will appear here.",
  startShopping: "Start shopping",
  priceFrom: "From {price}",
  removeFromList: "Remove from list",

  // Compare page
  compareHeading: "Compare Products",
  compareNote:
    "Product information comes from the real catalogue; your comparison list stays in this browser.",
  compareEmptyTitle: "No products to compare",
  compareEmptyDescription:
    "Tap 'Compare' on a product page and the side-by-side comparison will appear here (up to 3).",
  featureColumn: "Feature",
  removeShort: "Remove",
  differingBadge: "Different",

  // Server-page metadata + home hero stats (store-default locale).
  shopMetaDescription: "All products — find them with filters, sorting and search.",
  searchMetaTitle: "Search — Advance Ecommerce",
  searchMetaDescription: "Search products — in Bangla and Banglish.",
  homeMetaTitle: "Advance Ecommerce — Bangladesh's online shop",
  homeMetaDescription: "Fashion, electronics and much more — home delivery nationwide, cash on delivery.",
  homeOgDescription: "Bangladesh's online shop — home delivery, COD.",
  homeStatProducts: "Product collection",
  homeStatCategories: "Categories",
  homeStatDistricts: "Districts with home delivery",
};

export const STORE_STRINGS: Record<Locale, StoreStrings> = { bn, en };
