/**
 * Grocery weighted (per-kg) pricing — ADV-22 wiring (doc 22).
 *
 * MODEL (honest fixed-pack version — see grocery.ts for the audit):
 * quantities are integers at every seam of this platform (OrderItem,
 * CartItem, checkout zod, stock ledger), so fractional quantities
 * cannot flow. A weighted product is therefore sold as FIXED WEIGHT
 * PACKS configured in the grocery pack config (weightedVariants):
 * per-kg rate × pack grams → the pack's derived price, computed with
 * the pack's own priceForWeight (integer math, single floor).
 *
 * The RECORDED variant price (ProductVariant.pricePoisha) is what
 * checkout charges — checkout always re-reads it server-side. The
 * admin sync action below writes derived prices onto the recorded
 * prices; until a changed rate is synced, the recorded price stands
 * and display surfaces show the rate + pack weight WITHOUT presenting
 * the derived price as the price (inSync flags the divergence).
 */
import { priceForWeight, type GroceryConfig } from "./grocery";
import { getEnabledPackConfig, getSavedPackConfig } from "./config-store";

export interface WeightedVariantInfo {
  variantId: string;
  sku: string;
  productId: string;
  productTitleEn: string;
  packGrams: number;
  pricePerKgPoisha: number;
  /** floor(rate × packGrams / 1000) — the price the rate implies. */
  derivedPricePoisha: number;
  /** ProductVariant.pricePoisha — the price checkout actually charges. */
  recordedPricePoisha: number;
  /** derived === recorded. Display may quote the derived price only when true. */
  inSync: boolean;
}

async function loadInfos(config: GroceryConfig, onlyVariantIds?: readonly string[]): Promise<WeightedVariantInfo[]> {
  const entries = config.weightedVariants.filter(
    (w) => !onlyVariantIds || onlyVariantIds.includes(w.variantId),
  );
  if (entries.length === 0) return [];
  const { prisma } = await import("@advance-ecommerce/db");
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: entries.map((e) => e.variantId) }, deletedAt: null },
    select: {
      id: true,
      sku: true,
      pricePoisha: true,
      product: { select: { id: true, titleEn: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const infos: WeightedVariantInfo[] = [];
  for (const entry of entries) {
    const v = byId.get(entry.variantId);
    if (!v) continue; // configured variant was deleted — nothing to price or show
    const derivedPricePoisha = priceForWeight(entry.pricePerKgPoisha, entry.packGrams);
    infos.push({
      variantId: v.id,
      sku: v.sku,
      productId: v.product.id,
      productTitleEn: v.product.titleEn,
      packGrams: entry.packGrams,
      pricePerKgPoisha: entry.pricePerKgPoisha,
      derivedPricePoisha,
      recordedPricePoisha: v.pricePoisha,
      inSync: derivedPricePoisha === v.pricePoisha,
    });
  }
  return infos;
}

/** Weighted info for a set of variants (cart/checkout surfaces). Pack-gated. */
export async function getWeightedVariantInfos(
  variantIds: readonly string[],
): Promise<WeightedVariantInfo[]> {
  const config = await getEnabledPackConfig<GroceryConfig>("grocery");
  if (!config) return [];
  return loadInfos(config, variantIds);
}

/** Weighted info for every configured pack variant of one product (PDP). Pack-gated. */
export async function getWeightedInfosForProduct(productId: string): Promise<WeightedVariantInfo[]> {
  const config = await getEnabledPackConfig<GroceryConfig>("grocery");
  if (!config || config.weightedVariants.length === 0) return [];
  const all = await loadInfos(config);
  return all.filter((i) => i.productId === productId);
}

/** Weighted info for ALL configured variants (cart shell). Pack-gated. */
export async function getAllWeightedVariantInfos(): Promise<WeightedVariantInfo[]> {
  const config = await getEnabledPackConfig<GroceryConfig>("grocery");
  if (!config) return [];
  return loadInfos(config);
}

export interface WeightedPriceSyncReport {
  checked: number;
  updated: Array<{ variantId: string; sku: string; fromPoisha: number; toPoisha: number }>;
  unchanged: number;
  /** Configured variant ids with no live variant row (deleted) — skipped, named. */
  missingVariantIds: string[];
}

/**
 * The admin sync action: write each configured pack's derived price
 * onto its variant's recorded pricePoisha. Only diverged rows are
 * written. NOT flag-gated at this layer — the route decides who may
 * run it (staff preparing prices before enabling the pack is a
 * legitimate flow); it reads the SAVED config either way.
 */
export async function syncWeightedPrices(): Promise<WeightedPriceSyncReport> {
  const { config } = await getSavedPackConfig("grocery");
  const grocery = config as GroceryConfig;
  const infos = await loadInfos(grocery);
  const found = new Set(infos.map((i) => i.variantId));
  const missingVariantIds = grocery.weightedVariants
    .map((w) => w.variantId)
    .filter((id) => !found.has(id));
  const { prisma } = await import("@advance-ecommerce/db");
  const updated: WeightedPriceSyncReport["updated"] = [];
  let unchanged = 0;
  for (const info of infos) {
    if (info.inSync) {
      unchanged += 1;
      continue;
    }
    await prisma.productVariant.update({
      where: { id: info.variantId },
      data: { pricePoisha: info.derivedPricePoisha },
    });
    updated.push({
      variantId: info.variantId,
      sku: info.sku,
      fromPoisha: info.recordedPricePoisha,
      toPoisha: info.derivedPricePoisha,
    });
  }
  return { checked: infos.length, updated, unchanged, missingVariantIds };
}
