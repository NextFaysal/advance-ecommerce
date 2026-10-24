/**
 * POS catalog for the API routes — Agent 38; catalog DB swap 2026-10-24.
 *
 * Built from the REAL catalog DB: ACTIVE products from the Prisma
 * repository (via src/catalog/api getCatalogRepository), one entry per
 * active variant, in the exact lookup shape src/pos/register.ts
 * resolveScan() expects. The scan/sale contracts are unchanged. Throws
 * DbNotReadyError when the DB is unavailable — routes surface it as
 * 503 DB_NOT_READY; there is no mock fallback.
 */
import { getCatalogRepository } from "@/catalog/api";

export interface PosCatalogItem {
  variantId: string;
  sku: string;
  productName: string;
  pricePoisha: number;
  stock: number;
}

export async function posCatalog(): Promise<PosCatalogItem[]> {
  const repo = await getCatalogRepository();
  const { products } = await repo.listProducts({ status: "ACTIVE", page: 1, pageSize: 100 });
  const items: PosCatalogItem[] = [];
  for (const product of products) {
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
