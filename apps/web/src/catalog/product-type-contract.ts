// Product-type contract (Wave 15, doc 16 §P7) — UI-side view of the
// shapes the catalog service (wave 15-1) exposes for typed products.
//
// Product.type ∈ SIMPLE | DIGITAL | BUNDLE | PREORDER (default
// SIMPLE). The ADMIN and PUBLIC product shapes carry `type` plus the
// per-type blocks below; the editor payload sends `type` and ONLY the
// active type's block. Everything is gated behind the
// `module.product_types` feature flag — with the flag off the store
// behaves exactly as the pre-type catalogue did.
//
// This module deliberately does NOT extend ./types: the service wave
// owns those interfaces. Consumers read the extra fields through the
// view types here (a Product/PublicProduct cast to the matching view),
// so this file is the single place that states the wire contract the
// UI was built against:
//   - digitalFiles: [{ storageKey, fileName, sizeBytes }] — the
//     PUBLIC shape carries fileName + sizeBytes only (storageKey is
//     never public; it stays optional here so one entry type serves
//     both shapes).
//   - bundleComponents: [{ variantId, quantity }] on the wire; the
//     public shape additionally resolves the component product title,
//     the variant SKU and (when the service provides it) the variant
//     price — all optional here, rendered when present.
//   - preorder: { depositPercent?, expectedDate?, maxUnits? }.
//   - bundleAvailability (public shape only): whether the bundle can
//     currently be fulfilled from component stock. The service may
//     send a plain boolean or an object with an `available` flag —
//     bundleAvailabilityState() normalizes both; null means "the
//     service did not say", and callers fall back to the product's
//     own variant-stock behaviour.

import type { Product, PublicProduct } from "./types";

export type ProductTypeValue = "SIMPLE" | "DIGITAL" | "BUNDLE" | "PREORDER";

export interface DigitalFileEntry {
  /** Storage object key — admin shape only; never present publicly. */
  storageKey?: string;
  fileName: string;
  sizeBytes: number;
}

export interface BundleComponentEntry {
  variantId: string;
  quantity: number;
  /** Resolved display data — mirrors the service's BundleComponentView
   *  (wave-15 parent reconciliation); the editor's picker fills the
   *  same fields from the admin list API. */
  sku?: string;
  productTitle?: { bn: string; en: string };
  productSlug?: string;
  variantLabel?: string | null;
  unitPricePoisha?: number;
  componentStock?: number;
}

export interface PreorderEntry {
  depositPercent?: number | null;
  /** ISO date ("2026-03-01") or datetime — rendered as a plain date. */
  expectedDate?: string | null;
  maxUnits?: number | null;
}

export type BundleAvailabilityWire =
  | boolean
  | number
  | { available?: boolean; inStock?: boolean }
  | null
  | undefined;

export interface ProductTypeFields {
  type?: ProductTypeValue;
  digitalFiles?: DigitalFileEntry[];
  bundleComponents?: BundleComponentEntry[];
  preorder?: PreorderEntry | null;
  bundleAvailability?: BundleAvailabilityWire;
}

/** Admin Product + the type blocks (read via cast at the call site). */
export type ProductWithTypeFields = Product & ProductTypeFields;
/** Public product + the type blocks (read via cast at the call site). */
export type PublicProductWithTypeFields = PublicProduct & ProductTypeFields;

export function productTypeOf(fields: ProductTypeFields): ProductTypeValue {
  return fields.type ?? "SIMPLE";
}

/**
 * Normalize bundleAvailability: true/false when the service stated a
 * state, null when it said nothing (callers then keep the pre-type
 * variant-stock behaviour).
 */
export function bundleAvailabilityState(fields: ProductTypeFields): boolean | null {
  const a = fields.bundleAvailability;
  if (a === null || a === undefined) return null;
  if (typeof a === "boolean") return a;
  if (typeof a === "number") return a > 0;
  if (typeof a.available === "boolean") return a.available;
  if (typeof a.inStock === "boolean") return a.inStock;
  return null;
}

/** Human file size for admin + PDP lists ("512 KB", "1.2 MB"). */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** PLP card badge label per non-SIMPLE type. */
export const PRODUCT_TYPE_BADGE_LABEL: Record<Exclude<ProductTypeValue, "SIMPLE">, string> = {
  DIGITAL: "ডিজিটাল",
  BUNDLE: "বান্ডল",
  PREORDER: "প্রি-অর্ডার",
};
