/**
 * Electronics warranty cards — ADV-22 wiring (doc 22).
 *
 * Serial/IMEI capture already exists (ADV-20: SerialUnit rows are
 * allocated to an order at delivery), and EMI display exists
 * (ADV-18B). The remaining piece is the warranty card: for each of a
 * customer's orders, the recorded serials per item plus the warranty
 * period from the electronics pack config (months per category,
 * pack default otherwise).
 *
 * Honesty rules:
 *  - Warranty starts at DELIVERY. Before delivery there is no start
 *    date and no expiry to show — the card says the period and that
 *    it starts on delivery. After delivery the expiry is computed
 *    from the recorded DELIVERED transition timestamp (the pack's
 *    warrantyInfo), never from the order date.
 *  - Serials shown are the RECORDED SerialUnit rows for the order.
 *    An item with no recorded serials shows none — absence means
 *    untracked, never a fabricated number.
 */
import { warrantyInfo, warrantyMonthsForCategory, type ElectronicsConfig, type WarrantyInfo } from "./electronics";
import { packCategoryMatches } from "./packs";
import { getEnabledPackConfig, getSavedPackConfig } from "./config-store";

export interface OrderWarrantyItem {
  productName: string;
  sku: string;
  categorySlug: string;
  warrantyMonths: number;
  /** Recorded serial/IMEI numbers allocated to this order for this item's variant. */
  serials: string[];
  /** ISO date of the DELIVERED transition; null until delivered. */
  deliveredAt: string | null;
  /** Computed warranty window; null until delivered (it starts at delivery). */
  warranty: WarrantyInfo | null;
  /** Always true in this model — rendered verbatim on the card. */
  startsAtDelivery: true;
}

async function loadConfig(): Promise<ElectronicsConfig | null> {
  return getEnabledPackConfig<ElectronicsConfig>("electronics");
}

/**
 * Warranty cards for a set of orders (account page: the customer's
 * recent orders in one call). Orders without electronics-pack items
 * are absent from the map.
 */
export async function getOrderWarrantyCards(
  orderIds: readonly string[],
  now: Date = new Date(),
): Promise<Map<string, OrderWarrantyItem[]>> {
  const result = new Map<string, OrderWarrantyItem[]>();
  const config = await loadConfig();
  if (!config || orderIds.length === 0) return result;
  const { prisma } = await import("@advance-ecommerce/db");
  const orders = await prisma.order.findMany({
    where: { id: { in: [...orderIds] }, deletedAt: null },
    select: {
      id: true,
      items: {
        select: {
          productName: true,
          sku: true,
          variantId: true,
          variant: { select: { product: { select: { category: { select: { slug: true } } } } } },
        },
      },
      serialUnits: { select: { serial: true, variantId: true } },
      history: {
        where: { to: "DELIVERED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  for (const order of orders) {
    const deliveredAt = order.history[0]?.createdAt ?? null;
    const serialsByVariant = new Map<string, string[]>();
    for (const s of order.serialUnits) {
      const list = serialsByVariant.get(s.variantId) ?? [];
      list.push(s.serial);
      serialsByVariant.set(s.variantId, list);
    }
    const items: OrderWarrantyItem[] = [];
    for (const item of order.items) {
      const categorySlug = item.variant.product.category.slug;
      const months = warrantyMonthsForCategory(config, categorySlug, packCategoryMatches);
      if (months === null) continue;
      items.push({
        productName: item.productName,
        sku: item.sku,
        categorySlug,
        warrantyMonths: months,
        serials: serialsByVariant.get(item.variantId) ?? [],
        deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
        warranty: deliveredAt ? warrantyInfo(deliveredAt, months, now) : null,
        startsAtDelivery: true,
      });
    }
    if (items.length > 0) result.set(order.id, items);
  }
  return result;
}

export interface WarrantyTerm {
  categorySlug: string;
  months: number;
}

/**
 * Warranty terms for the checkout confirmation: the distinct
 * electronics-pack categories in the order and their months. No
 * serials exist at confirmation time (they are allocated at
 * delivery) — terms only, with the starts-at-delivery note.
 */
export async function getWarrantyTermsForCategories(
  categorySlugs: readonly string[],
): Promise<WarrantyTerm[]> {
  const { config } = await getSavedPackConfig("electronics");
  const electronics = config as ElectronicsConfig;
  const terms: WarrantyTerm[] = [];
  const seen = new Set<string>();
  for (const slug of categorySlugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    const months = warrantyMonthsForCategory(electronics, slug, packCategoryMatches);
    if (months !== null) terms.push({ categorySlug: slug, months });
  }
  return terms;
}
