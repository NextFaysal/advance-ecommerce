// Meilisearch index mapping — Step 10 contract.
// Bangla + Banglish aware, typo-tolerant. The real indexer (Step 10) must use
// exactly these searchable/filterable/sortable attributes so admin and storefront
// search behave the same.

/** Banglish -> Bangla synonym groups. Kept small and curated; admin can extend it. */
export const BANGLISH_SYNONYMS: Record<string, string[]> = {
  jama: ["জামা"],
  jamah: ["জামা"],
  sharee: ["শাড়ি", "শাড়ি"],
  sari: ["শাড়ি"],
  panjabi: ["পাঞ্জাবি"],
  punjabi: ["পাঞ্জাবি"],
  kurti: ["কুর্তি"],
  salwar: ["সালোয়ার"],
  hijab: ["হিজাব"],
  tshirt: ["টি-শার্ট"],
  "t-shirt": ["টি-শার্ট"],
  shirt: ["শার্ট"],
  pant: ["প্যান্ট"],
  shoes: ["জুতা"],
  juta: ["জুতা"],
  bag: ["ব্যাগ"],
  watch: ["ঘড়ি"],
  ghori: ["ঘড়ি"],
  mobile: ["মোবাইল"],
  phone: ["মোবাইল", "ফোন"],
  charger: ["চার্জার"],
  skincare: ["স্কিনকেয়ার"],
  cream: ["ক্রিম"],
};

/** Normalize a query for matching: trim, lowercase latin, collapse spaces. */
export function normalizeSearchQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Expand a Banglish query token with its Bangla synonyms for client-side hinting.
 *  Meilisearch itself gets the same synonyms via its synonyms API (see index config below).
 */
export function expandQueryTokens(query: string): string[] {
  const tokens = normalizeSearchQuery(query).split(" ").filter(Boolean);
  const expanded = new Set<string>(tokens);
  for (const token of tokens) {
    for (const synonym of BANGLISH_SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

export interface MeilisearchProductDocument {
  id: string;
  slug: string;
  /** Lifecycle status — filterable so public queries can hard-require
   *  ACTIVE. Only ACTIVE products are ever written to the public index
   *  (see indexer.ts); this field is the second, query-time gate. */
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  categorySlug: string;
  brandName: string | null;
  tags: string[];
  /** Integer poisha — filterable range, never float */
  minPricePoisha: number;
  maxPricePoisha: number;
  inStock: boolean;
  ratingAverage: number | null;
  createdAt: string;
}

export const PRODUCTS_INDEX_CONFIG = {
  primaryKey: "id",
  searchableAttributes: [
    "titleBn",
    "titleEn",
    "descriptionBn",
    "descriptionEn",
    "brandName",
    "tags",
    "categorySlug",
  ],
  filterableAttributes: [
    "status",
    "categorySlug",
    "brandName",
    "tags",
    "minPricePoisha",
    "maxPricePoisha",
    "inStock",
    "ratingAverage",
  ],
  sortableAttributes: ["minPricePoisha", "ratingAverage", "createdAt"],
  // Typo tolerance: 1 typo for short words, 2 for longer — Meilisearch default
  // typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } }
  // Synonyms: upload BANGLISH_SYNONYMS (flattened to Meilisearch format) via
  // POST /indexes/products/settings/synonyms when the indexer runs in Step 10.
  typoTolerance: { enabled: true, minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 } },
} as const;

export type SortOption =
  | "relevance"
  | "price-asc"
  | "price-desc"
  | "rating"
  | "newest";

export interface ProductFilter {
  query?: string;
  categorySlug?: string;
  brandName?: string;
  minPricePoisha?: number;
  maxPricePoisha?: number;
  inStockOnly?: boolean;
  sort?: SortOption;
}

/** Apply filter+sort to a mock list (mirrors the Meilisearch query the real
 *  service will build). Used by shop/search pages until Step 10 wiring lands. */
export function applyProductFilter<T extends {
  slug: string;
  categorySlug: string;
  brandName: string | null;
  variants: { pricePoisha: number; stock: number; isActive: boolean }[];
  ratingAverage: number | null;
  createdAt: string;
  title: { bn: string; en: string };
}>(products: T[], filter: ProductFilter): T[] {
  let out = [...products];
  if (filter.query) {
    const terms = expandQueryTokens(filter.query);
    out = out.filter((p) => {
      const haystack = `${p.title.bn} ${p.title.en} ${p.slug}`.toLowerCase();
      return terms.some((t) => haystack.includes(t.toLowerCase()));
    });
  }
  if (filter.categorySlug) out = out.filter((p) => p.categorySlug === filter.categorySlug);
  if (filter.brandName) out = out.filter((p) => p.brandName === filter.brandName);
  if (filter.inStockOnly) {
    out = out.filter((p) => p.variants.some((v) => v.isActive && v.stock > 0));
  }
  if (filter.minPricePoisha !== undefined) {
    out = out.filter((p) =>
      p.variants.some((v) => v.isActive && v.pricePoisha >= (filter.minPricePoisha ?? 0)),
    );
  }
  if (filter.maxPricePoisha !== undefined) {
    out = out.filter((p) =>
      p.variants.some((v) => v.isActive && v.pricePoisha <= (filter.maxPricePoisha ?? 0)),
    );
  }
  const minPrice = (p: T): number => {
    const prices = p.variants.filter((v) => v.isActive).map((v) => v.pricePoisha);
    return prices.length ? Math.min(...prices) : 0;
  };
  switch (filter.sort) {
    case "price-asc":
      out.sort((a, b) => minPrice(a) - minPrice(b));
      break;
    case "price-desc":
      out.sort((a, b) => minPrice(b) - minPrice(a));
      break;
    case "rating":
      out.sort((a, b) => (b.ratingAverage ?? 0) - (a.ratingAverage ?? 0));
      break;
    case "newest":
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    default:
      break;
  }
  return out;
}
