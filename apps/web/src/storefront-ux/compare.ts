/**
 * Product comparison — Part B. Pure logic: a compare tray of at most 3
 * products and a side-by-side attribute table where rows whose values
 * differ are flagged, so the customer sees the difference at a glance.
 */
import type { PublicProduct } from "@/catalog/types";
import { publicPriceRangePoisha } from "./quick-view";

export const MAX_COMPARE_PRODUCTS = 3;

export type CompareAddResult =
  | { ok: true; ids: string[] }
  | { ok: false; ids: string[]; error: "full" | "duplicate" };

export function addToCompare(ids: string[], productId: string): CompareAddResult {
  if (ids.includes(productId)) return { ok: false, ids, error: "duplicate" };
  if (ids.length >= MAX_COMPARE_PRODUCTS) return { ok: false, ids, error: "full" };
  return { ok: true, ids: [...ids, productId] };
}

export function removeFromCompare(ids: string[], productId: string): string[] {
  return ids.filter((id) => id !== productId);
}

export function toggleCompare(ids: string[], productId: string): CompareAddResult {
  if (ids.includes(productId)) return { ok: true, ids: removeFromCompare(ids, productId) };
  return addToCompare(ids, productId);
}

export interface ComparisonRow {
  key: string;
  labelBn: string;
  labelEn: string;
  /** One cell per product, in the order of the input products. null = not applicable. */
  values: Array<string | null>;
  /** True when not all non-null values are equal. */
  differing: boolean;
}

export interface ComparisonTable {
  productIds: string[];
  rows: ComparisonRow[];
}

function row(key: string, labelBn: string, labelEn: string, values: Array<string | null>): ComparisonRow {
  const present = values.filter((v) => v !== null);
  return { key, labelBn, labelEn, values, differing: new Set(present).size > 1 };
}

export function buildComparison(products: PublicProduct[]): ComparisonTable {
  const selected = products.slice(0, MAX_COMPARE_PRODUCTS);
  const rows: ComparisonRow[] = [
    row("title", "পণ্য", "Product", selected.map((p) => p.title.bn)),
    row("price", "দাম (থেকে)", "Price (from)", selected.map((p) => String(publicPriceRangePoisha(p).min))),
    row("brand", "ব্র্যান্ড", "Brand", selected.map((p) => p.brandName)),
    row("category", "ক্যাটাগরি", "Category", selected.map((p) => p.categoryName.bn)),
    row("rating", "রেটিং", "Rating", selected.map((p) => (p.ratingAverage === null ? null : p.ratingAverage.toFixed(1)))),
    row("reviews", "রিভিউ সংখ্যা", "Reviews", selected.map((p) => String(p.reviewCount))),
    row(
      "stock",
      "মোট স্টক",
      "Total stock",
      selected.map((p) => String(p.variants.filter((v) => v.isActive).reduce((sum, v) => sum + v.stock, 0))),
    ),
  ];
  // Attribute diff: union of attribute keys across variants (e.g. size, color).
  const attrKeys = new Set<string>();
  for (const p of selected) {
    for (const v of p.variants) for (const k of Object.keys(v.attributes)) attrKeys.add(k);
  }
  for (const key of [...attrKeys].sort()) {
    rows.push(
      row(
        `attr:${key}`,
        key,
        key,
        selected.map((p) => {
          const values = [...new Set(p.variants.map((v) => v.attributes[key]).filter((x): x is string => typeof x === "string"))];
          return values.length > 0 ? values.join(", ") : null;
        }),
      ),
    );
  }
  return { productIds: selected.map((p) => p.id), rows };
}
