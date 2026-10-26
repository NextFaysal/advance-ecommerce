/**
 * Delivered-order hooks — the post-delivery fan-out, run ONCE per order
 * when (and only when) it transitions INTO DELIVERED.
 *
 * Call sites (the two server-side funnels that persist Order.status):
 *  - applyOrderTransition() in src/orders/repository.ts — after its
 *    transaction commits, when the state machine moved the order into
 *    DELIVERED (admin PATCH, call-center outcomes).
 *  - saveOrder() in the same file — when a bulk-actions mutation moves
 *    the stored status into DELIVERED.
 * Mirroring markOrderPayment's discipline, this module is the ONLY
 * caller of the loyalty / reseller / vendor credit functions below, so
 * the exactly-once guarantees live in exactly one place.
 *
 * NEVER-THROW RULE (same as the event bus): a hook failure must never
 * fail or roll back the delivery itself. Every section is isolated in
 * its own try/catch and logs server-side; the credit functions are
 * each idempotent per order, so a later replay (or a retry after a
 * partial failure) converges instead of double-paying:
 *  - Loyalty EARN: entry id is derived from the order id
 *    (pts_earn_<orderId>) — replay returns the stored entry.
 *  - Referral reward: fires only while the referral is PENDING and
 *    spends referral-derived entry ids.
 *  - Reseller wallet: creditDeliveredOrderDb checks for existing
 *    credit entries for the order before writing.
 *  - Vendor commission: VendorCommissionLine @@unique([orderId,
 *    vendorId]) + the store's read-before-write make it one line per
 *    order per vendor.
 *
 * WHAT IS *NOT* HERE, honestly:
 *  - Affiliate commission (loyalty/db-store's
 *    recordAffiliateCommissionForDelivery) needs an attributed
 *    partnerId; orders carry NO affiliate attribution (the cookie
 *    window in loyalty/types.ts is a type-level contract only), so
 *    there is nothing truthful to record yet.
 */
import { prisma } from "@advance-ecommerce/db";
import { loadTierConfig } from "../reseller/tier-config";
import { commissionForAmountPoisha } from "../reseller/tiers";
import { creditDeliveredOrderDb, getReseller, getResellerTierState } from "../reseller/store";
import { vendorStore } from "../vendors/db-store";
import { demoVendorFlags } from "../vendors/flags";
import { computeCommission } from "../vendors/service";

function logHookError(section: string, orderId: string, err: unknown): void {
  console.error(`[delivered-hooks] ${section} failed for order ${orderId}:`, err);
}

/** Points + referral reward for the order's customer. */
async function creditLoyalty(order: {
  id: string;
  customerId: string;
  totalPoisha: number;
}): Promise<void> {
  // Dynamic import: src/loyalty/db-store.ts imports getOrderByIdOrNo
  // from src/orders/repository.ts, and repository.ts imports THIS
  // module — a static import here would close that cycle.
  const loyalty = await import("../loyalty/db-store");
  const nowIso = new Date().toISOString();
  await loyalty.creditLoyaltyForDeliveredOrder({
    customerId: order.customerId,
    orderId: order.id,
    orderTotalPoisha: order.totalPoisha,
    nowIso,
  });
  // Referral reward: only when this delivery is the referee's FIRST
  // order (the customer's earliest order is this one).
  const firstOrder = await prisma.order.findFirst({
    where: { customerId: order.customerId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  await loyalty.qualifyReferralForDeliveredOrder({
    refereeCustomerId: order.customerId,
    orderId: order.id,
    isRefereeFirstOrder: firstOrder?.id === order.id,
    nowIso,
  });
}

/** Commission + margin into the attributed reseller's wallet. */
async function creditReseller(order: {
  id: string;
  totalPoisha: number;
  resellerId: string;
  items: { variantId: string; unitPricePoisha: number; quantity: number }[];
}): Promise<void> {
  const reseller = await getReseller(order.resellerId);
  if (!reseller) return;
  // Tier at credit time (ADV-12): the tier engine derives the tier from
  // lifetime earned COMMISSION before this credit (this order has no
  // credit entries yet), with rates/thresholds from Settings
  // (reseller.tiers.*). The new credit is priced at THAT tier's rate;
  // creditDeliveredOrderDb refreshes the stored tier cache afterwards.
  const tierConfig = await loadTierConfig();
  const tierState = await getResellerTierState(order.resellerId, tierConfig);
  if (!tierState) return;
  const commissionPoisha = commissionForAmountPoisha(order.totalPoisha, tierState.rateBps);
  // Margin: only for items the reseller has a price entry for.
  // basePricePoisha resolves exactly like reseller/store's
  // listPriceEntries: variant cost, falling back to the catalog price.
  const priceRows = await prisma.resellerPriceEntry.findMany({
    where: { resellerId: order.resellerId, variantId: { in: order.items.map((i) => i.variantId).filter((v): v is string => typeof v === "string") } },
  });
  let marginPoisha = 0;
  if (priceRows.length > 0) {
    const priceByVariant = new Map(priceRows.filter((r) => r.variantId !== null).map((r) => [r.variantId as string, r.pricePoisha]));
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: [...priceByVariant.keys()] } },
      select: { id: true, costPoisha: true, pricePoisha: true },
    });
    const baseByVariant = new Map(variants.map((v) => [v.id, v.costPoisha ?? v.pricePoisha]));
    for (const item of order.items) {
      const resellerPrice = priceByVariant.get(item.variantId);
      const base = baseByVariant.get(item.variantId);
      if (resellerPrice === undefined || base === undefined) continue;
      marginPoisha += Math.max(0, resellerPrice - base) * item.quantity;
    }
  }
  await creditDeliveredOrderDb({
    resellerId: order.resellerId,
    orderId: order.id,
    commissionPoisha,
    marginPoisha,
    tierConfig,
  });
}

/** One commission line per vendor whose APPROVED listing (of an ACTIVE
 *  vendor) matches an order item's variant. Flag-gated: the vendor
 *  module is a paid add-on and computeCommission asserts the flag. */
async function creditVendors(order: {
  id: string;
  items: { variantId: string; unitPricePoisha: number; quantity: number }[];
}): Promise<void> {
  if (!demoVendorFlags.isEnabled("module.multi_vendor")) return;
  const variantIds = [...new Set(order.items.map((i) => i.variantId))];
  if (variantIds.length === 0) return;
  const listings = await prisma.vendorProduct.findMany({
    where: { variantId: { in: variantIds }, approval: "APPROVED", deletedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (listings.length === 0) return;
  // First APPROVED listing per variant wins (deterministic by createdAt).
  const vendorByVariant = new Map<string, string>();
  for (const listing of listings) {
    if (listing.variantId && !vendorByVariant.has(listing.variantId)) {
      vendorByVariant.set(listing.variantId, listing.vendorId);
    }
  }
  const grossByVendor = new Map<string, number>();
  for (const item of order.items) {
    const vendorId = vendorByVariant.get(item.variantId);
    if (!vendorId) continue;
    grossByVendor.set(vendorId, (grossByVendor.get(vendorId) ?? 0) + item.unitPricePoisha * item.quantity);
  }
  for (const [vendorId, grossPoisha] of grossByVendor) {
    if (grossPoisha <= 0) continue;
    const vendor = await vendorStore.getVendor(vendorId);
    if (!vendor || vendor.status !== "ACTIVE") continue;
    const line = computeCommission(order.id, vendor, grossPoisha);
    await vendorStore.addCommissionLine(line);
  }
}

/**
 * ADV-20 inventory depth at delivery: recorded serials flip to SOLD
 * (with the order ref) and tracked batches deplete FEFO. The seam is
 * HERE — not at reservation — because this module is the platform's
 * exactly-once-per-INTO-DELIVERED-transition fan-out, the same
 * discipline the credits above follow: reserving a serial at
 * reservation time would strand units on never-delivered orders.
 * Dynamic import keeps src/inventory off this module's static graph
 * (batches.ts reads the flag source, which the flag DB layer wires
 * independently). The depth module self-gates on
 * module.inventory_depth; with the flag OFF this writes nothing.
 */
async function applyInventoryDepth(order: {
  id: string;
  items: { variantId: string; quantity: number }[];
}): Promise<void> {
  const depth = await import("../inventory/batches");
  await depth.applyDeliveryDepth(order);
}

/**
 * Run every delivered-order credit for an order that has JUST been
 * persisted as DELIVERED. Loads the order row itself so call sites
 * stay one line. Never throws.
 */
export async function runDeliveredOrderHooks(orderId: string): Promise<void> {
  try {
    const row = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: {
        id: true,
        customerId: true,
        totalPoisha: true,
        resellerId: true,
        status: true,
        items: { select: { variantId: true, unitPricePoisha: true, quantity: true } },
      },
    });
    if (!row || row.status !== "DELIVERED") return;
    try {
      await creditLoyalty(row);
    } catch (err) {
      logHookError("loyalty", row.id, err);
    }
    if (row.resellerId) {
      try {
        await creditReseller({ ...row, resellerId: row.resellerId });
      } catch (err) {
        logHookError("reseller", row.id, err);
      }
    }
    try {
      await creditVendors(row);
    } catch (err) {
      logHookError("vendors", row.id, err);
    }
    try {
      await applyInventoryDepth(row);
    } catch (err) {
      logHookError("inventory-depth", row.id, err);
    }
  } catch (err) {
    logHookError("load", orderId, err);
  }
}
