/**
 * Verified-purchase computation — ADV-16 review depth (doc 22).
 * Server-only.
 *
 * DEFINITION: a review counts as a verified purchase iff the
 * customer it is linked to has a DELIVERED order containing the
 * reviewed product. Nothing weaker counts — a PENDING / CONFIRMED /
 * SHIPPED order has not put the product in the customer's hands,
 * and a CANCELLED order never did. (This tightens the wave-5
 * submission-time link, which accepted any non-CANCELLED order.)
 *
 * The badge is COMPUTED from real Order / OrderItem rows at read
 * time — never trusted from a stored flag — so it stays correct
 * when an order's status changes after the review was written.
 */
import { prisma } from "@advance-ecommerce/db";

/** Set key for one (customer, product) pair. */
export function verifiedPurchaseKey(customerId: string, productId: string): string {
  return `${customerId}::${productId}`;
}

/** Single-pair check (detail views, tests). */
export async function hasDeliveredPurchase(
  customerId: string,
  productId: string,
): Promise<boolean> {
  if (!customerId || !productId) return false;
  const item = await prisma.orderItem.findFirst({
    where: {
      variant: { productId },
      order: { customerId, status: "DELIVERED" },
    },
    select: { id: true },
  });
  return item !== null;
}

/**
 * Batch check for list views: one query for any number of
 * (customerId, productId) pairs, returning the subset that is
 * verified as a Set of verifiedPurchaseKey() strings. Pairs with a
 * null customerId (anonymous reviews) are never verified.
 */
export async function computeVerifiedPurchaseKeys(
  pairs: readonly { customerId: string | null; productId: string }[],
): Promise<Set<string>> {
  const wanted = new Map<string, { customerId: string; productId: string }>();
  for (const pair of pairs) {
    if (pair.customerId) {
      wanted.set(verifiedPurchaseKey(pair.customerId, pair.productId), {
        customerId: pair.customerId,
        productId: pair.productId,
      });
    }
  }
  const verified = new Set<string>();
  if (wanted.size === 0) return verified;

  const customerIds = [...new Set([...wanted.values()].map((p) => p.customerId))];
  const productIds = [...new Set([...wanted.values()].map((p) => p.productId))];
  const items = await prisma.orderItem.findMany({
    where: {
      variant: { productId: { in: productIds } },
      order: { customerId: { in: customerIds }, status: "DELIVERED" },
    },
    select: {
      variant: { select: { productId: true } },
      order: { select: { customerId: true } },
    },
  });
  for (const item of items) {
    const key = verifiedPurchaseKey(item.order.customerId, item.variant.productId);
    if (wanted.has(key)) verified.add(key);
  }
  return verified;
}
