/**
 * POS demo catalog for the API routes — Agent 38.
 *
 * Built from the TEMPORARY MOCK catalog (src/catalog/mock MOCK_PRODUCTS):
 * one entry per product variant, in the exact lookup shape
 * src/pos/register.ts resolveScan() expects. Labelled TEMPORARY MOCK —
 * when the catalog DB service lands, this reads variants from there
 * instead and the scan/sale contracts do not change.
 */
import { MOCK_PRODUCTS } from "@/catalog/mock";

export interface PosCatalogItem {
  variantId: string;
  sku: string;
  productName: string;
  pricePoisha: number;
  stock: number;
}

export function posCatalog(): PosCatalogItem[] {
  const items: PosCatalogItem[] = [];
  for (const product of MOCK_PRODUCTS) {
    for (const variant of product.variants) {
      if (!variant.isActive) continue;
      const attributeText = Object.values(variant.attributes).join(" / ");
      items.push({
        variantId: variant.id,
        sku: variant.sku,
        productName: attributeText ? `${product.title.bn} (${attributeText})` : product.title.bn,
        pricePoisha: variant.pricePoisha,
        stock: variant.stock,
      });
    }
  }
  return items;
}
