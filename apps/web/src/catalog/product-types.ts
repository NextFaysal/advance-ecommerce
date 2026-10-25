/**
 * Product types engine (wave 15, doc 16 P7) — SERVER ONLY.
 *
 * Everything here is gated by the `module.product_types` feature flag
 * (absent = OFF, fail-closed). When the flag is OFF this module is a
 * no-op everywhere it is wired: bundle/preorder order rules do not
 * run and digital fulfilment does not issue grants.
 *
 * STOCK SEAM — read this before touching checkout:
 * This platform's order create (src/orders/repository.createOrderRecord)
 * NEVER moved stock for ordinary items: variant.stock is a read-only
 * check at the route, no SALE_RESERVE/COMMIT movements are written for
 * any product today (documented in the public orders route header).
 * Bundle components are the exception the P7 contract demands, and
 * they are wired HERE, inside createOrderRecord's single transaction:
 *
 *  - CHECK: for every BUNDLE item, each component variant must hold
 *    stock >= component.quantity x ordered qty (summed across all
 *    bundle lines in the order that share a component). Failure throws
 *    BundleStockError and rolls the whole order back.
 *  - DEDUCT (reserve-at-checkout, the platform's documented policy):
 *    the component variant's stock cache is decremented and a
 *    SALE_RESERVE StockMovement is written against the default
 *    warehouse with referenceType "ORDER" / referenceId = order id,
 *    InventoryItem upserted (quantityOnHand mirrors the cache,
 *    quantityReserved += need). The bundle variant's OWN stock is
 *    untouched — it is a pricing shell.
 *  - There is NO commit step: this platform never implemented
 *    reserve->commit for any item, so the SALE_RESERVE is the terminal
 *    ledger state for components, exactly as it would be for ordinary
 *    items had they been wired. If an order is CANCELLED, the reserve
 *    is released (restoreBundleComponentsForOrder, ledger-idempotent)
 *    from the two status funnels in src/orders/repository.ts.
 *  - If no warehouse exists to book against, the cache still moves and
 *    the movement is skipped with a server-side warning (the catalog
 *    module's ledgerPending precedent — never silently pretend).
 *
 * PREORDER: terms live on Product (preorderMaxUnits etc.). Order
 * create refuses when prior non-cancelled ordered units for the
 * product + this order's units exceed maxUnits. depositPercent is
 * informational (checkout display) — the payment split is out of
 * scope this wave.
 *
 * DIGITAL FULFILMENT seam: markOrderPayment (the ONE order-paid
 * funnel) calls runDigitalFulfilmentForOrder after the PAID
 * transition commits — digital goods deliver on payment, not on
 * physical DELIVERED. Grants carry only a SHA-256 token hash; the raw
 * token is returned once, here, to the funnel's caller for logging /
 * future buyer-notification wiring (no buyer channel consumes it yet —
 * the buyer retrieves links from their account/orders surface built
 * by wave 15-3; tokens are never persisted raw, so a lost token can
 * only be re-issued by revoking the grant, not recovered).
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { presignGetObject, resolveStorageConfig } from "./media-server";

export const PRODUCT_TYPES_FLAG = "module.product_types";

/** The generated client's transaction type, inferred (the web app
 *  has no @prisma/client dependency — inference is the house pattern). */
export type ProductTypesTx = Parameters<Parameters<(typeof prisma)["$transaction"]>[0]>[0];
type PrismaTx = ProductTypesTx;

/** Route-layer flag read (unified in-process reader, same as the
 *  call-center routes). */
export function isProductTypesEnabled(): boolean {
  return isFeatureEnabled(PRODUCT_TYPES_FLAG);
}

/**
 * True when a create/update payload carries product-type data while
 * the module flag is OFF — the catalog routes answer those with 403
 * FEATURE_LOCKED. A plain SIMPLE payload (the pre-wave-15 shape) is
 * never locked, so the flag's absence changes nothing for ordinary
 * products.
 */
export function productTypePayloadLocked(input: {
  type?: string;
  digitalFiles?: readonly unknown[];
  bundleComponents?: readonly unknown[];
  preorder?: unknown;
}): boolean {
  if (isProductTypesEnabled()) return false;
  return (
    (input.type !== undefined && input.type !== "SIMPLE") ||
    (input.digitalFiles !== undefined && input.digitalFiles.length > 0) ||
    (input.bundleComponents !== undefined && input.bundleComponents.length > 0) ||
    (input.preorder !== undefined && input.preorder !== null)
  );
}

/** Direct-DB flag read for cross-process / funnel paths (the
 *  call-center automation precedent): fail-closed on any error. */
export async function productTypesEnabledInDb(): Promise<boolean> {
  try {
    const row = await prisma.featureFlag.findUnique({
      where: { key: PRODUCT_TYPES_FLAG },
      select: { enabled: true },
    });
    return row?.enabled === true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Typed order-create failures                                         */
/* ------------------------------------------------------------------ */

export class BundleStockError extends Error {
  readonly code = "INSUFFICIENT_STOCK";
  constructor(
    message: string,
    readonly details: { variantId: string; sku: string; available: number; required: number },
  ) {
    super(message);
    this.name = "BundleStockError";
  }
}

export class PreorderCapError extends Error {
  readonly code = "PREORDER_CAP_REACHED";
  constructor(
    message: string,
    readonly details: { productId: string; maxUnits: number; alreadyOrdered: number; requested: number },
  ) {
    super(message);
    this.name = "PreorderCapError";
  }
}

/* ------------------------------------------------------------------ */
/* Order create: preorder cap + bundle check/deduct                    */
/* ------------------------------------------------------------------ */

interface OrderLineLike {
  variantId: string;
  quantity: number;
}

/**
 * Pre-check + cap enforcement, run INSIDE the create transaction
 * before the order row exists. Returns the bundle component needs so
 * the caller can deduct after the order id exists. Throws
 * PreorderCapError / BundleStockError (typed, route-mappable).
 */
export async function validateProductTypeRules(
  tx: PrismaTx,
  items: OrderLineLike[],
): Promise<{ componentNeeds: Map<string, number> }> {
  const componentNeeds = new Map<string, number>();
  if (items.length === 0) return { componentNeeds };
  if (!(await productTypesEnabledInDb())) return { componentNeeds };

  const variantIds = [...new Set(items.map((i) => i.variantId))];
  const variants = await tx.productVariant.findMany({
    where: { id: { in: variantIds }, deletedAt: null },
    select: {
      id: true,
      productId: true,
      product: { select: { id: true, type: true, preorderMaxUnits: true } },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  // --- Pre-order caps (per product, across all its variants) ---
  const preorderRequested = new Map<string, number>();
  for (const item of items) {
    const v = byId.get(item.variantId);
    if (v && v.product.type === "PREORDER" && v.product.preorderMaxUnits !== null) {
      preorderRequested.set(
        v.product.id,
        (preorderRequested.get(v.product.id) ?? 0) + item.quantity,
      );
    }
  }
  for (const [productId, requested] of preorderRequested) {
    const product = variants.find((v) => v.product.id === productId)?.product;
    const maxUnits = product?.preorderMaxUnits;
    if (maxUnits === null || maxUnits === undefined) continue;
    const prior = await tx.orderItem.aggregate({
      where: {
        variant: { productId },
        order: { status: { not: "CANCELLED" } },
      },
      _sum: { quantity: true },
    });
    const alreadyOrdered = prior._sum.quantity ?? 0;
    if (alreadyOrdered + requested > maxUnits) {
      throw new PreorderCapError(
        `Pre-order cap reached for product ${productId}: ${alreadyOrdered} of ${maxUnits} units already ordered.`,
        { productId, maxUnits, alreadyOrdered, requested },
      );
    }
  }

  // --- Bundle component needs (summed across bundle lines) ---
  const bundleProductIds = new Set<string>();
  for (const item of items) {
    const v = byId.get(item.variantId);
    if (v && v.product.type === "BUNDLE") bundleProductIds.add(v.product.id);
  }
  if (bundleProductIds.size === 0) return { componentNeeds };

  const components = await tx.bundleComponent.findMany({
    where: { bundleProductId: { in: [...bundleProductIds] } },
    select: {
      bundleProductId: true,
      quantity: true,
      componentVariantId: true,
      componentVariant: { select: { sku: true, stock: true, deletedAt: true } },
    },
  });
  const componentsByProduct = new Map<string, typeof components>();
  for (const c of components) {
    const list = componentsByProduct.get(c.bundleProductId) ?? [];
    list.push(c);
    componentsByProduct.set(c.bundleProductId, list);
  }
  // Stock snapshot for the error path + the deduction step.
  const componentStock = new Map<string, { sku: string; stock: number }>();
  for (const item of items) {
    const v = byId.get(item.variantId);
    if (!v || v.product.type !== "BUNDLE") continue;
    const lines = componentsByProduct.get(v.product.id) ?? [];
    if (lines.length === 0) {
      throw new BundleStockError(
        `Bundle product ${v.product.id} has no components configured and cannot be fulfilled.`,
        { variantId: item.variantId, sku: "", available: 0, required: item.quantity },
      );
    }
    for (const line of lines) {
      componentNeeds.set(
        line.componentVariantId,
        (componentNeeds.get(line.componentVariantId) ?? 0) + line.quantity * item.quantity,
      );
      componentStock.set(line.componentVariantId, {
        sku: line.componentVariant.sku,
        stock: line.componentVariant.stock,
      });
    }
  }
  for (const [componentVariantId, required] of componentNeeds) {
    const snap = componentStock.get(componentVariantId);
    const available = snap?.stock ?? 0;
    if (available < required) {
      throw new BundleStockError(
        `Insufficient component stock for bundle: ${snap?.sku ?? componentVariantId} needs ${required}, has ${available}.`,
        { variantId: componentVariantId, sku: snap?.sku ?? "", available, required },
      );
    }
  }
  return { componentNeeds };
}

/**
 * Deduct bundle components (SALE_RESERVE through the stock ledger),
 * run INSIDE the create transaction after the order row exists.
 * Re-reads each component's stock inside the transaction so the
 * movement's before/after figures are the committed ones.
 */
export async function deductBundleComponents(
  tx: PrismaTx,
  componentNeeds: Map<string, number>,
  orderId: string,
  orderNo: string,
): Promise<void> {
  if (componentNeeds.size === 0) return;
  const warehouse = await tx.warehouse.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  for (const [variantId, need] of componentNeeds) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true, sku: true },
    });
    if (!variant) continue;
    const before = variant.stock;
    const after = before - need;
    if (after < 0) {
      // validateProductTypeRules already checked within this same
      // transaction; a negative here means a concurrent write raced
      // us — fail the order rather than oversell silently.
      throw new BundleStockError(
        `Insufficient component stock for bundle: ${variant.sku} needs ${need}, has ${before}.`,
        { variantId, sku: variant.sku, available: before, required: need },
      );
    }
    await tx.productVariant.update({ where: { id: variantId }, data: { stock: after } });
    if (warehouse) {
      await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId: warehouse.id,
          type: "SALE_RESERVE",
          quantityDelta: -need,
          quantityBefore: before,
          quantityAfter: after,
          referenceType: "ORDER",
          referenceId: orderId,
          reason: `Bundle component reserve for order ${orderNo}`,
          actorId: null,
        },
      });
      await tx.inventoryItem.upsert({
        where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
        create: {
          variantId,
          warehouseId: warehouse.id,
          quantityOnHand: after,
          quantityReserved: need,
        },
        update: {
          quantityOnHand: after,
          quantityReserved: { increment: need },
        },
      });
    } else {
      console.warn(
        `[product-types] bundle reserve for order ${orderNo}: no warehouse to book the ledger movement against (variant ${variantId}, qty ${need}) — stock cache moved, movement skipped.`,
      );
    }
  }
}

/**
 * Release bundle component reserves when an order is CANCELLED.
 * Ledger-idempotent: an order whose SALE_RESERVE movements already
 * have matching SALE_RELEASE movements is a no-op. Never throws —
 * callers run it after the status commit (delivered-hooks discipline).
 */
export async function restoreBundleComponentsForOrder(orderId: string): Promise<void> {
  try {
    if (!(await productTypesEnabledInDb())) return;
    const reserves = await prisma.stockMovement.findMany({
      where: { referenceType: "ORDER", referenceId: orderId, type: "SALE_RESERVE" },
      select: { variantId: true, warehouseId: true, quantityDelta: true },
    });
    if (reserves.length === 0) return;
    const releases = await prisma.stockMovement.findMany({
      where: { referenceType: "ORDER", referenceId: orderId, type: "SALE_RELEASE" },
      select: { variantId: true, quantityDelta: true },
    });
    const releasedByVariant = new Map<string, number>();
    for (const r of releases) {
      releasedByVariant.set(r.variantId, (releasedByVariant.get(r.variantId) ?? 0) + r.quantityDelta);
    }
    for (const reserve of reserves) {
      const reservedQty = -reserve.quantityDelta;
      const alreadyReleased = releasedByVariant.get(reserve.variantId) ?? 0;
      const toRelease = reservedQty - alreadyReleased;
      if (toRelease <= 0) continue;
      await prisma.$transaction(async (tx) => {
        const variant = await tx.productVariant.findUnique({
          where: { id: reserve.variantId },
          select: { stock: true },
        });
        if (!variant) return;
        const before = variant.stock;
        const after = before + toRelease;
        await tx.productVariant.update({ where: { id: reserve.variantId }, data: { stock: after } });
        await tx.stockMovement.create({
          data: {
            variantId: reserve.variantId,
            warehouseId: reserve.warehouseId,
            type: "SALE_RELEASE",
            quantityDelta: toRelease,
            quantityBefore: before,
            quantityAfter: after,
            referenceType: "ORDER",
            referenceId: orderId,
            reason: "Bundle component reserve released (order cancelled)",
            actorId: null,
          },
        });
        await tx.inventoryItem.upsert({
          where: {
            variantId_warehouseId: { variantId: reserve.variantId, warehouseId: reserve.warehouseId },
          },
          create: {
            variantId: reserve.variantId,
            warehouseId: reserve.warehouseId,
            quantityOnHand: after,
            quantityReserved: 0,
          },
          update: {
            quantityOnHand: after,
            quantityReserved: { decrement: toRelease },
          },
        });
      });
    }
  } catch (err) {
    console.error(`[product-types] bundle reserve release failed for order ${orderId}:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Digital fulfilment (on the transition INTO PAID)                    */
/* ------------------------------------------------------------------ */

export const DOWNLOAD_GRANT_TTL_DAYS = 7;
export const DOWNLOAD_GRANT_MAX_DOWNLOADS = 5;

export interface IssuedDownloadGrant {
  orderItemId: string;
  digitalFileId: string;
  fileName: string;
  /** The RAW bearer token — returned exactly once, never persisted. */
  token: string;
  expiresAt: string;
}

export interface DigitalFulfilmentResult {
  orderId: string;
  grants: IssuedDownloadGrant[];
  licenseKeys: { orderItemId: string; productId: string; key: string }[];
  /** True when grants already existed for this order (replay). */
  alreadyFulfilled: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Issue download grants + license keys for an order's DIGITAL items.
 * Idempotent per order: existing grants short-circuit (their raw
 * tokens are unrecoverable by design). Never throws — the payment
 * funnel calls it after committing PAID and a fulfilment failure must
 * not fail the payment. Returns null when the module flag is OFF or
 * the order has no digital items.
 */
export async function runDigitalFulfilmentForOrder(
  orderId: string,
): Promise<DigitalFulfilmentResult | null> {
  try {
    if (!(await productTypesEnabledInDb())) return null;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            variant: {
              select: {
                product: {
                  select: {
                    id: true,
                    type: true,
                    digitalFiles: { select: { id: true, fileName: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return null;
    const digitalItems = order.items.filter((i) => i.variant.product.type === "DIGITAL");
    if (digitalItems.length === 0) return null;

    const existing = await prisma.downloadGrant.count({ where: { orderId } });
    if (existing > 0) {
      return { orderId, grants: [], licenseKeys: [], alreadyFulfilled: true };
    }

    const expiresAt = new Date(Date.now() + DOWNLOAD_GRANT_TTL_DAYS * 24 * 60 * 60 * 1000);
    const grants: IssuedDownloadGrant[] = [];
    const licenseKeys: DigitalFulfilmentResult["licenseKeys"] = [];
    await prisma.$transaction(async (tx) => {
      for (const item of digitalItems) {
        for (const file of item.variant.product.digitalFiles) {
          const token = randomBytes(32).toString("hex");
          await tx.downloadGrant.create({
            data: {
              orderId,
              orderItemId: item.id,
              digitalFileId: file.id,
              tokenHash: hashToken(token),
              expiresAt,
              maxDownloads: DOWNLOAD_GRANT_MAX_DOWNLOADS,
              downloadsUsed: 0,
            },
          });
          grants.push({
            orderItemId: item.id,
            digitalFileId: file.id,
            fileName: file.fileName,
            token,
            expiresAt: expiresAt.toISOString(),
          });
        }
        // One license key per digital order ITEM, from the product's
        // pool when one is available; an empty pool is not an error
        // (the download grant is the delivery; keys are an add-on).
        const candidate = await tx.licenseKey.findFirst({
          where: { productId: item.variant.product.id, assignedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, key: true },
        });
        if (candidate) {
          const claimed = await tx.licenseKey.updateMany({
            where: { id: candidate.id, assignedAt: null },
            data: { orderId, assignedAt: new Date() },
          });
          if (claimed.count === 1) {
            licenseKeys.push({
              orderItemId: item.id,
              productId: item.variant.product.id,
              key: candidate.key,
            });
          }
        }
      }
    });
    return { orderId, grants, licenseKeys, alreadyFulfilled: false };
  } catch (err) {
    console.error(`[product-types] digital fulfilment failed for order ${orderId}:`, err);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Download redemption (public token route)                            */
/* ------------------------------------------------------------------ */

export type RedeemDownloadResult =
  | { ok: true; url: string; fileName: string; downloadsRemaining: number }
  | {
      ok: false;
      code: "NOT_FOUND" | "EXPIRED" | "EXHAUSTED" | "STORAGE_NOT_CONFIGURED" | "FEATURE_LOCKED";
      message: string;
    };

/**
 * Redeem one download token: hash lookup, expiry + count enforced,
 * the use is consumed only when a signed URL can actually be issued.
 */
export async function redeemDownloadToken(token: string): Promise<RedeemDownloadResult> {
  if (!(await productTypesEnabledInDb())) {
    return { ok: false, code: "FEATURE_LOCKED", message: "ডিজিটাল ডাউনলোড এই ইনস্টলে সক্রিয় নয়।" };
  }
  const grant = await prisma.downloadGrant.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      maxDownloads: true,
      downloadsUsed: true,
      digitalFile: { select: { storageKey: true, fileName: true } },
    },
  });
  if (!grant) {
    return { ok: false, code: "NOT_FOUND", message: "ডাউনলোড লিংকটি পাওয়া যায়নি।" };
  }
  if (grant.expiresAt.getTime() <= Date.now()) {
    return { ok: false, code: "EXPIRED", message: "ডাউনলোড লিংকটির মেয়াদ শেষ হয়ে গেছে।" };
  }
  if (grant.downloadsUsed >= grant.maxDownloads) {
    return {
      ok: false,
      code: "EXHAUSTED",
      message: "এই লিংকের সর্বোচ্চ ডাউনলোড সংখ্যা শেষ হয়ে গেছে।",
    };
  }
  const config = await resolveStorageConfig();
  if (config === null) {
    return {
      ok: false,
      code: "STORAGE_NOT_CONFIGURED",
      message: "স্টোরেজ কনফিগার করা হয়নি — সহায়তার জন্য আমাদের সাথে যোগাযোগ করুন।",
    };
  }
  // Guarded increment: the count check and the consume are one write,
  // so two concurrent clicks can never mint more than maxDownloads.
  const consumed = await prisma.downloadGrant.updateMany({
    where: { id: grant.id, downloadsUsed: { lt: grant.maxDownloads } },
    data: { downloadsUsed: { increment: 1 } },
  });
  if (consumed.count === 0) {
    return {
      ok: false,
      code: "EXHAUSTED",
      message: "এই লিংকের সর্বোচ্চ ডাউনলোড সংখ্যা শেষ হয়ে গেছে।",
    };
  }
  const url = presignGetObject({ config, key: grant.digitalFile.storageKey, expiresInSeconds: 900 });
  return {
    ok: true,
    url,
    fileName: grant.digitalFile.fileName,
    downloadsRemaining: grant.maxDownloads - grant.downloadsUsed - 1,
  };
}

/* ------------------------------------------------------------------ */
/* License-key pool (admin)                                            */
/* ------------------------------------------------------------------ */

export async function addLicenseKeys(
  productId: string,
  rawKeys: string[],
): Promise<{ added: number; skippedDuplicates: number; poolTotal: number; poolAvailable: number }> {
  // skippedDuplicates counts every non-blank line that did not become
  // a new pool row: repeats inside the paste itself AND keys already
  // in the pool (for this or any other product — keys are globally
  // unique).
  const nonBlank = rawKeys.map((k) => k.trim()).filter((k) => k !== "");
  const cleaned = [...new Set(nonBlank)];
  const existing = await prisma.licenseKey.findMany({
    where: { key: { in: cleaned } },
    select: { key: true },
  });
  const existingSet = new Set(existing.map((e) => e.key));
  const fresh = cleaned.filter((k) => !existingSet.has(k));
  if (fresh.length > 0) {
    await prisma.licenseKey.createMany({
      data: fresh.map((key) => ({ productId, key })),
      skipDuplicates: true,
    });
  }
  const [poolTotal, poolAvailable] = await Promise.all([
    prisma.licenseKey.count({ where: { productId } }),
    prisma.licenseKey.count({ where: { productId, assignedAt: null } }),
  ]);
  return {
    added: fresh.length,
    skippedDuplicates: nonBlank.length - fresh.length,
    poolTotal,
    poolAvailable,
  };
}

export interface LicenseKeyView {
  id: string;
  /** Masked: only the last 4 characters ever leave the server. */
  maskedKey: string;
  assigned: boolean;
  orderId: string | null;
  assignedAt: string | null;
  createdAt: string;
}

export async function listLicenseKeys(productId: string): Promise<LicenseKeyView[]> {
  const rows = await prisma.licenseKey.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, key: true, orderId: true, assignedAt: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    maskedKey: `••••${r.key.slice(-4)}`,
    assigned: r.assignedAt !== null,
    orderId: r.orderId,
    assignedAt: r.assignedAt ? r.assignedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}
