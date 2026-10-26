// Catalog types — Step 8-11 skeleton.
// TEMPORARY MOCK data lives in ./mock.ts only. These types are the contract
// that the real Prisma service (Step 8) must satisfy when it replaces the mock.
// Money: ALL prices are integer poisha. Never float in storage/calculation.

export type Locale = "bn" | "en";

export interface LocalizedText {
  bn: string;
  en: string;
}

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

/** Product types (wave 15, doc 16 P7) — everything type-specific is
 *  gated by the module.product_types feature flag. */
export type ProductType = "SIMPLE" | "DIGITAL" | "BUNDLE" | "PREORDER";

/** Staff view of a digital file: includes the storage key (needed by
 *  the editor to round-trip the row). NEVER sent publicly. */
export interface DigitalFileMeta {
  id: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

/** Public view of a digital file: name + size only — no storage key. */
export interface PublicDigitalFile {
  id: string;
  fileName: string;
  sizeBytes: number;
}

/** One bundle component as read everywhere: the component variant's
 *  identity + how many units one bundle sale consumes + the variant's
 *  current stock cache (drives bundleAvailability). */
export interface BundleComponentView {
  variantId: string;
  sku: string;
  productTitle: LocalizedText;
  productSlug: string;
  /** Attributes summary ("Size: M · Colour: Red") or null when none. */
  variantLabel: string | null;
  unitPricePoisha: number;
  quantity: number;
  componentStock: number;
}

/** Pre-order terms of record (stored on Product.preorder* columns). */
export interface PreorderTerms {
  depositPercent: number | null;
  /** ISO date (yyyy-mm-dd) or null. */
  expectedDate: string | null;
  maxUnits: number | null;
}

export interface ProductAttribute {
  /** e.g. "color" | "size" */
  key: string;
  label: LocalizedText;
  /** e.g. color: ["লাল", "নীল"], size: ["M", "L"] — values are display strings */
  values: string[];
}

export interface ProductVariant {
  id: string;
  productId: string;
  /** Attribute selection, e.g. { color: "লাল", size: "M" } */
  attributes: Record<string, string>;
  sku: string;
  barcode: string | null;
  /** Integer poisha */
  pricePoisha: number;
  /** Integer poisha, nullable — shown as "compare at" / MRP */
  compareAtPoisha: number | null;
  /** Integer poisha, staff-only in admin — never sent to public API */
  costPoisha: number | null;
  stock: number;
  imageUrl: string | null;
  isActive: boolean;
}

export interface ProductImage {
  id: string;
  url: string;
  /** WebP/AVIF preferred; original kept only for re-encode. See SCHEMA-ADDITIONS.md */
  altBn: string;
  altEn: string;
  sortOrder: number;
}

/** Size-chart table (wave 14, doc 16 P5): header labels + one string
 *  row per size. Stored as Product.sizeChart Json; the catalog service
 *  validates this exact shape on every write. */
export interface SizeChart {
  headers: string[];
  rows: string[][];
}

/** One product FAQ entry (wave 14, doc 16 P5) — Product.faqItems Json. */
export interface FaqItem {
  q: string;
  a: string;
}

export interface Product {
  id: string;
  slug: string;
  title: LocalizedText;
  description: LocalizedText;
  categorySlug: string;
  categoryName: LocalizedText;
  brandName: string | null;
  status: ProductStatus;
  images: ProductImage[];
  variants: ProductVariant[];
  ratingAverage: number | null;
  reviewCount: number;
  tags: string[];
  /** SEO fields — see SCHEMA-ADDITIONS.md */
  seoTitle: LocalizedText | null;
  seoDescription: LocalizedText | null;
  /** Social-share (OG/Twitter) image URL; null = PDP falls back to the first gallery image. */
  ogImage: string | null;
  /** Product video URL (wave 14); null = no video block on the PDP. */
  videoUrl: string | null;
  sizeChart: SizeChart | null;
  faqItems: FaqItem[] | null;
  /** Scheduling (wave 14): ISO instants, null = unset. A future
   *  publishAt hides the product from PUBLIC reads (read-time gate in
   *  the catalog service); admin reads always see it. */
  publishAt: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  /** Merchant-picked related product ids (wave 14, max 20). */
  relatedIds: string[];
  /** Physicals for courier weight-based pricing (wave 14). */
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  /** Per-product low-stock threshold override; null = global default. */
  lowStockThreshold: number | null;
  /**
   * Price on request (schema wave 2): when true the storefront
   * hides the price + add-to-cart and shows "দামের জন্য যোগাযোগ
   * করুন" with a contact path instead. Defaults false.
   */
  priceOnRequest: boolean;
  /** Product type (wave 15); SIMPLE for everything pre-existing. */
  type: ProductType;
  /** DIGITAL files (staff view — carries storageKey). */
  digitalFiles: DigitalFileMeta[];
  /** BUNDLE components; empty for non-bundles. */
  bundleComponents: BundleComponentView[];
  /** Sellable units of a BUNDLE = min over components of
   *  floor(componentStock / quantity); null for non-bundles. */
  bundleAvailability: number | null;
  /** PREORDER terms; null unless set (and only meaningful for PREORDER). */
  preorder: PreorderTerms | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  slug: string;
  name: LocalizedText;
  imageUrl: string | null;
  productCount: number;
}

/** Public product view: costPoisha stripped. Admin view uses Product directly. */
export type PublicVariant = Omit<ProductVariant, "costPoisha">;
export type PublicProduct = Omit<Product, "variants" | "digitalFiles"> & {
  variants: PublicVariant[];
  /** Public digital files: fileName/sizeBytes only — the storage key
   *  and any license material never leave the server. */
  digitalFiles: PublicDigitalFile[];
  /**
   * Derived sale-window state (wave 14): true when `now` falls inside
   * [saleStartsAt, saleEndsAt] — a null bound is open (no start = the
   * sale is already on, no end = it runs until cleared). This flag
   * NEVER changes prices by itself; PDP/PLP use it to decide whether
   * the compare-at "sale" presentation applies.
   */
  saleActive: boolean;
};

/** Pure sale-window derivation shared by toPublicProduct and tests. */
export function isSaleActive(
  product: { saleStartsAt: string | null; saleEndsAt: string | null },
  now: Date = new Date(),
): boolean {
  const t = now.getTime();
  if (product.saleStartsAt !== null && t < new Date(product.saleStartsAt).getTime()) return false;
  if (product.saleEndsAt !== null && t > new Date(product.saleEndsAt).getTime()) return false;
  return true;
}

export function toPublicProduct(product: Product): PublicProduct {
  return {
    ...product,
    variants: product.variants.map(({ costPoisha: _cost, ...rest }) => rest),
    digitalFiles: product.digitalFiles.map((f) => ({
      id: f.id,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
    })),
    saleActive: isSaleActive(product),
  };
}

/** Sellable bundle units from component stock: the scarcest component
 *  (in whole bundle units) caps the bundle. Empty component list = 0
 *  (a bundle with no components can never be fulfilled). */
export function computeBundleAvailability(
  components: ReadonlyArray<{ quantity: number; componentStock: number }>,
): number {
  if (components.length === 0) return 0;
  return Math.min(
    ...components.map((c) => Math.floor(c.componentStock / Math.max(1, c.quantity))),
  );
}

/** Structural minimum the price helpers need — accepts both the admin
 *  Product and the cost-free PublicProduct, so client components typed
 *  on PublicProduct can price without ever seeing costPoisha. */
export interface PricedVariantSet {
  variants: ReadonlyArray<{ isActive: boolean; pricePoisha: number }>;
}

export function minVariantPricePoisha(product: PricedVariantSet): number {
  const prices = product.variants.filter((v) => v.isActive).map((v) => v.pricePoisha);
  return prices.length > 0 ? Math.min(...prices) : 0;
}

export function maxVariantPricePoisha(product: PricedVariantSet): number {
  const prices = product.variants.filter((v) => v.isActive).map((v) => v.pricePoisha);
  return prices.length > 0 ? Math.max(...prices) : 0;
}
