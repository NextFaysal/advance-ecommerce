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
export type PublicProduct = Omit<Product, "variants"> & { variants: PublicVariant[] };

export function toPublicProduct(product: Product): PublicProduct {
  return {
    ...product,
    variants: product.variants.map(({ costPoisha: _cost, ...rest }) => rest),
  };
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
