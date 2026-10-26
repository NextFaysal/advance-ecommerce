/**
 * Reorder / buy-again resolution — plan 17 batch O2.
 *
 * Given one of the customer's OWN past orders, decide what can go back
 * into the cart TODAY: every line is re-resolved against the live
 * catalog (the same visibility rules the storefront uses — product
 * ACTIVE, not soft-deleted, publishAt reached; variant active and not
 * soft-deleted) and priced at the CURRENT variant price.
 *
 * This NEVER creates an order and NEVER reserves stock — it only
 * builds a cart payload. The actual order still goes through the one
 * create funnel (POST /api/v1/public/orders via checkout), which
 * re-validates price and stock again at submit time.
 *
 * Bundle note: the quantity cap uses the variant's denormalized stock
 * cache — the same snapshot every add-to-cart surface uses. For BUNDLE
 * products the true sellable count is component-derived and is
 * enforced inside the create transaction (wave 15), so a reorder can
 * fill the cart but can never oversell the bundle.
 */
import { prisma } from "@advance-ecommerce/db";
import { qtyNumber } from "../lib/quantity";

/** One past-order line that can be re-added to the cart right now. */
export interface ReorderAddedItem {
  variantId: string;
  productId: string;
  productSlug: string;
  /** Product title (Bangla) — the cart snapshot name, as AddToCartButton stores it. */
  name: string;
  sku: string;
  /** Quantity that can be re-added: the ordered quantity capped at current stock. */
  quantity: number;
  /** Quantity on the original order (quantity < requestedQuantity means it was capped). */
  requestedQuantity: number;
  /** CURRENT unit price, integer poisha. */
  unitPricePoisha: number;
  /** Unit price paid on the original order, integer poisha. */
  previousUnitPricePoisha: number;
  /** True when the current price differs from the ordered price. */
  priceChanged: boolean;
  /** Current stock of the variant (the cap source). */
  availableStock: number;
  imageUrl?: string;
}

export type ReorderSkipReason = "DISCONTINUED" | "OUT_OF_STOCK";

/** One past-order line that cannot be re-added, with the reason. */
export interface ReorderSkippedItem {
  variantId: string;
  /** Product name snapshot from the original order. */
  name: string;
  sku: string;
  requestedQuantity: number;
  reason: ReorderSkipReason;
  reasonBn: string;
  reasonEn: string;
}

export interface ReorderResolution {
  orderId: string;
  orderNo: string;
  items: ReorderAddedItem[];
  skipped: ReorderSkippedItem[];
}

const SKIP_COPY: Record<ReorderSkipReason, { bn: string; en: string }> = {
  DISCONTINUED: {
    bn: "এই পণ্যটি এখন আর বিক্রি হচ্ছে না।",
    en: "This item is no longer sold.",
  },
  OUT_OF_STOCK: {
    bn: "এই পণ্যের স্টক এখন শেষ।",
    en: "This item is out of stock right now.",
  },
};

/**
 * Resolve a reorder for `orderId` owned by `customerId`.
 * Returns null when the order does not exist OR does not belong to
 * this customer — the route maps both to the same 404 so one customer
 * can never probe another customer's orders.
 */
export async function resolveReorder(
  customerId: string,
  orderId: string,
): Promise<ReorderResolution | null> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      items: {
        select: {
          variantId: true,
          productName: true,
          sku: true,
          unitPricePoisha: true,
          quantity: true,
        },
      },
    },
  });
  if (order === null) return null;

  const variantIds = [...new Set(order.items.map((i) => i.variantId))];
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      productId: true,
      sku: true,
      pricePoisha: true,
      stock: true,
      imageUrl: true,
      isActive: true,
      deletedAt: true,
      product: {
        select: {
          slug: true,
          titleBn: true,
          status: true,
          deletedAt: true,
          publishAt: true,
        },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const now = new Date();

  const items: ReorderAddedItem[] = [];
  const skipped: ReorderSkippedItem[] = [];

  for (const line of order.items) {
    // Wave 59: the stored quantity is a Decimal — work with the
    // milli-exact app number (a fractional line re-orders fractionally,
    // capped by the variant's whole-unit stock).
    const orderedQty = qtyNumber(line.quantity);
    const variant = byId.get(line.variantId);
    // Storefront visibility, mirrored from the catalog's public rules:
    // product ACTIVE + not deleted + publishAt reached (wave 14 gate),
    // variant active + not deleted. Anything else reads as discontinued.
    const live =
      variant !== undefined &&
      variant.deletedAt === null &&
      variant.isActive &&
      variant.product.deletedAt === null &&
      variant.product.status === "ACTIVE" &&
      (variant.product.publishAt === null || variant.product.publishAt <= now);

    if (!live || variant === undefined) {
      const copy = SKIP_COPY.DISCONTINUED;
      skipped.push({
        variantId: line.variantId,
        name: line.productName,
        sku: line.sku,
        requestedQuantity: orderedQty,
        reason: "DISCONTINUED",
        reasonBn: copy.bn,
        reasonEn: copy.en,
      });
      continue;
    }
    if (variant.stock <= 0) {
      const copy = SKIP_COPY.OUT_OF_STOCK;
      skipped.push({
        variantId: line.variantId,
        name: line.productName,
        sku: line.sku,
        requestedQuantity: orderedQty,
        reason: "OUT_OF_STOCK",
        reasonBn: copy.bn,
        reasonEn: copy.en,
      });
      continue;
    }
    items.push({
      variantId: variant.id,
      productId: variant.productId,
      productSlug: variant.product.slug,
      name: variant.product.titleBn,
      sku: variant.sku,
      quantity: Math.min(orderedQty, variant.stock),
      requestedQuantity: orderedQty,
      unitPricePoisha: variant.pricePoisha,
      previousUnitPricePoisha: line.unitPricePoisha,
      priceChanged: variant.pricePoisha !== line.unitPricePoisha,
      availableStock: variant.stock,
      imageUrl: variant.imageUrl ?? undefined,
    });
  }

  return { orderId: order.id, orderNo: order.orderNo, items, skipped };
}
