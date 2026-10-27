/**
 * Storefront UX (Part B) — shared types. Agent 19.
 * Money is integer poisha everywhere. No type here may carry a full
 * customer phone, a payment-link token, or a token hash — public surfaces
 * only ever receive masked/derived data.
 */

/** One recently-viewed product entry (localStorage, browser-only data). */
export interface RecentlyViewedEntry {
  productId: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  /** Integer poisha — lowest active variant price at view time. */
  pricePoisha: number;
  imageUrl: string | null;
  viewedAt: string;
}

/** Render-ready data for the product quick-view modal. */
export interface QuickViewData {
  productId: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  imageUrl: string | null;
  brandName: string | null;
  /** Integer poisha range across active variants. */
  minPricePoisha: number;
  maxPricePoisha: number;
  variants: Array<{
    variantId: string;
    label: string;
    pricePoisha: number;
    stock: number;
    inStock: boolean;
  }>;
  ratingAverage: number | null;
  reviewCount: number;
  inStock: boolean;
  /** Fashion-pack products render a "সাইজ গাইড" button in quick view. */
  hasSizeGuide: boolean;
}

/** Back-in-stock notification signup (Step: Part B). */
export interface BackInStockSignup {
  productId: string;
  variantId: string | null;
  /** Normalized +8801XXXXXXXXX — stored server-side only, never re-exposed in full. */
  phone: string;
  createdAt: string;
}

/** Public view of a signup: phone masked, no internal fields. */
export interface BackInStockSignupPublic {
  productId: string;
  variantId: string | null;
  maskedPhone: string;
  createdAt: string;
}
