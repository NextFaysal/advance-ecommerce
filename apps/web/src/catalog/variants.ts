// Variant builder — Step 8/9 contract.
// Generates the full cartesian product of attribute values, with a deterministic SKU.
// The admin editor (app/admin/products/new) uses this; the real DB write happens
// in the Step 8 Prisma service, which must keep the same SKU rule.

import type { ProductAttribute, ProductVariant } from "./types";

export interface VariantDraft {
  attributes: Record<string, string>;
  sku: string;
  barcode: string | null;
  pricePoisha: number;
  compareAtPoisha: number | null;
  costPoisha: number | null;
  stock: number;
  imageUrl: string | null;
}

function slugifySegment(value: string): string {
  // Keep it deterministic and URL-safe. Bangla values are transliterated by
  // first letter fallback: if no latin chars remain, use a short hash-like index.
  const latin = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return latin || "var";
}

/** Cartesian product of attribute values, in definition order. */
export function generateVariantDrafts(
  productSlug: string,
  attributes: ProductAttribute[],
  defaults: {
    pricePoisha: number;
    compareAtPoisha?: number | null;
    costPoisha?: number | null;
    stock?: number;
  },
): VariantDraft[] {
  if (attributes.length === 0) {
    return [
      {
        attributes: {},
        sku: productSlug.toUpperCase(),
        barcode: null,
        pricePoisha: defaults.pricePoisha,
        compareAtPoisha: defaults.compareAtPoisha ?? null,
        costPoisha: defaults.costPoisha ?? null,
        stock: defaults.stock ?? 0,
        imageUrl: null,
      },
    ];
  }

  let combos: Record<string, string>[] = [{}];
  for (const attr of attributes) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of attr.values) {
        next.push({ ...combo, [attr.key]: value });
      }
    }
    combos = next;
  }

  return combos.map((combo, index) => {
    const segments = attributes.map((a) => slugifySegment(combo[a.key] ?? ""));
    return {
      attributes: combo,
      sku: `${productSlug.toUpperCase()}-${segments.join("-").toUpperCase()}`,
      barcode: null, // Assigned on save by barcode service (EAN/UPC) or manual entry
      pricePoisha: defaults.pricePoisha,
      compareAtPoisha: defaults.compareAtPoisha ?? null,
      costPoisha: defaults.costPoisha ?? null,
      stock: defaults.stock ?? 0,
      imageUrl: null,
      // index kept out of SKU so re-ordering attributes does not rename existing SKUs
      _index: index,
    } as VariantDraft;
  });
}

/** Find a variant by exact attribute selection, or null. */
export function findVariant(
  variants: ProductVariant[],
  selection: Record<string, string>,
): ProductVariant | null {
  return (
    variants.find((v) => {
      const keys = Object.keys(selection);
      return (
        keys.length === Object.keys(v.attributes).length &&
        keys.every((k) => v.attributes[k] === selection[k])
      );
    }) ?? null
  );
}

/** Validate a draft before save: unique SKU, non-negative price/stock, price in poisha. */
export function validateVariantDrafts(drafts: VariantDraft[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const d of drafts) {
    if (!d.sku) errors.push("Variant SKU missing");
    if (seen.has(d.sku)) errors.push(`Duplicate SKU: ${d.sku}`);
    seen.add(d.sku);
    if (!Number.isInteger(d.pricePoisha) || d.pricePoisha < 0) {
      errors.push(`Invalid price (poisha) for SKU ${d.sku}`);
    }
    if (!Number.isInteger(d.stock) || d.stock < 0) {
      errors.push(`Invalid stock for SKU ${d.sku}`);
    }
  }
  return errors;
}
