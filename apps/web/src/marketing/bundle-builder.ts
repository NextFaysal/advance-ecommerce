/**
 * Bundle builder — ADV-18B (doc 22), built over the EXISTING bundle
 * machinery (wave 15/16: product type BUNDLE + BundleComponent rows).
 *
 * What the machinery actually supports today (verified on disk):
 * - A bundle is its own product with its own sellable variant(s);
 *   BundleComponent is a FLAT list of (componentVariantId, quantity)
 *   — there are NO component groups and NO optional flags in the
 *   model, and there is NO bundle discount config anywhere. The
 *   order seam (src/catalog/product-types.ts applyBundleAndPreorder
 *   Rules) deducts the FIXED component list at order time.
 * - So a "pick your components" builder cannot exist without
 *   changing the order seam (out of scope here): any selection the
 *   customer made would be ignored at fulfilment. What CAN be built
 *   honestly is this read-model page: every ACTIVE bundle with its
 *   fixed contents, the real component-price sum vs the bundle
 *   variant's price (the difference is money the recorded prices
 *   actually save — no invented percentage), a quantity choice, and
 *   add-to-cart of the bundle variant itself — the exact cart line
 *   the PDP buy box creates (src/cart AddToCartButton path). The
 *   page labels the contents as fixed ("কম্পোনেন্ট নির্ধারিত").
 * - Savings are only stated when every component price is known and
 *   the sum exceeds the bundle price; otherwise no savings claim is
 *   rendered at all.
 */
import { listActivePublicProducts } from "@/catalog/server-read";
import { productTypesEnabledInDb } from "@/catalog/product-types";
import {
  productTypeOf,
  bundleAvailabilityState,
  type PublicProductWithTypeFields,
  type BundleComponentEntry,
} from "@/catalog/product-type-contract";

export interface BundleBuildComponent {
  variantId: string;
  titleBn: string;
  titleEn: string;
  productSlug: string | null;
  variantLabel: string | null;
  sku: string | null;
  quantity: number;
  unitPricePoisha: number | null;
  lineTotalPoisha: number | null;
}

export interface BundleBuild {
  productId: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  imageUrl: string | null;
  /** The sellable bundle variant (first active — the PDP default). */
  variantId: string;
  variantSku: string;
  bundlePricePoisha: number;
  variantStock: number;
  components: BundleBuildComponent[];
  /** Σ component prices; null when any component price is unknown. */
  componentsTotalPoisha: number | null;
  /** componentsTotal - bundlePrice when positive and known, else null. */
  savingsPoisha: number | null;
  /** Component-derived sellable count when the service states one. */
  availableCount: number | null;
  available: boolean;
}

function toComponent(entry: BundleComponentEntry): BundleBuildComponent {
  const unitPricePoisha = typeof entry.unitPricePoisha === "number" ? entry.unitPricePoisha : null;
  return {
    variantId: entry.variantId,
    titleBn: entry.productTitle?.bn ?? "",
    titleEn: entry.productTitle?.en ?? "",
    productSlug: entry.productSlug ?? null,
    variantLabel: entry.variantLabel ?? null,
    sku: entry.sku ?? null,
    quantity: entry.quantity,
    unitPricePoisha,
    lineTotalPoisha: unitPricePoisha !== null ? unitPricePoisha * entry.quantity : null,
  };
}

/** All ACTIVE bundles for the builder page. Empty when the product-
 *  types module is off (bundles don't exist publicly then) or the
 *  catalogue has none — the page renders an honest empty state. */
export async function listBundleBuilds(): Promise<{ moduleEnabled: boolean; bundles: BundleBuild[] }> {
  const moduleEnabled = await productTypesEnabledInDb();
  if (!moduleEnabled) return { moduleEnabled: false, bundles: [] };
  const products = (await listActivePublicProducts(100)) as PublicProductWithTypeFields[];
  const bundles: BundleBuild[] = [];
  for (const product of products) {
    if (productTypeOf(product) !== "BUNDLE") continue;
    const variant = product.variants.find((v) => v.isActive);
    if (variant === undefined) continue;
    const components = (product.bundleComponents ?? []).map(toComponent);
    const componentsTotalPoisha = components.every((c) => c.lineTotalPoisha !== null)
      ? components.reduce((sum, c) => sum + (c.lineTotalPoisha ?? 0), 0)
      : null;
    const savingsPoisha =
      componentsTotalPoisha !== null && componentsTotalPoisha > variant.pricePoisha
        ? componentsTotalPoisha - variant.pricePoisha
        : null;
    const availabilityState = bundleAvailabilityState(product);
    const availableCount = typeof product.bundleAvailability === "number" ? product.bundleAvailability : null;
    bundles.push({
      productId: product.id,
      slug: product.slug,
      titleBn: product.title.bn,
      titleEn: product.title.en,
      imageUrl: product.images[0]?.url ?? null,
      variantId: variant.id,
      variantSku: variant.sku,
      bundlePricePoisha: variant.pricePoisha,
      variantStock: variant.stock,
      components,
      componentsTotalPoisha,
      savingsPoisha,
      availableCount,
      available: availabilityState === false ? false : availableCount !== null ? availableCount > 0 : variant.stock > 0,
    });
  }
  return { moduleEnabled: true, bundles };
}
