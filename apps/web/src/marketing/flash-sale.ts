// Flash sale types + validation — schema-faithful rewrite (2026-10-25).
//
// The Prisma models are the contract:
//   FlashSale     { id, name, startsAt, endsAt, isActive, deletedAt?,
//                   createdAt, updatedAt, items[] }
//   FlashSaleItem { id, flashSaleId, productId, variantId,
//                   salePricePoisha, stockCap, soldCount, createdAt }
//                   @@unique([flashSaleId, variantId])
//
// The previous version of this file carried stockCap/soldCount on the
// SALE itself — the schema puts them on each ITEM, so aggregated
// helpers below sum across items instead. All timestamps cross the
// wire as ISO strings; the DB stores instants and "live" is decided by
// instant comparison (startsAt <= now <= endsAt), which is inherently
// timezone-correct — Asia/Dhaka only matters for display/input.
//
// Invariant (schema + service): soldCount must never exceed stockCap
// for an item. This module only reads/carries the values; the order
// path that increments soldCount must enforce the cap transactionally.
//
// This module is intentionally SCHEMA-FREE (types + pure helpers
// only): client components (the admin flash-sale manager) import it,
// and the zod write-validation schemas live in ./flash-sale-server
// so the zod runtime never enters a browser bundle through here.

/** One FlashSaleItem row, exactly as persisted (no display data). */
export interface FlashSaleItemRecord {
  id: string;
  flashSaleId: string;
  productId: string;
  variantId: string;
  /** Integer poisha — the flash price for this variant. */
  salePricePoisha: number;
  stockCap: number;
  soldCount: number;
  createdAt: string;
}

/** One FlashSale row with its item rows. */
export interface FlashSaleRecord {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: FlashSaleItemRecord[];
}

/**
 * A flash-sale item enriched with the product/variant display data a
 * storefront or admin surface needs. Assembled by the repository from
 * Product + ProductVariant (+ first ProductImage); prices are integer
 * poisha throughout.
 */
export interface FlashSaleItemDisplay extends FlashSaleItemRecord {
  productTitleBn: string;
  productTitleEn: string;
  productSlug: string;
  /** Product.status ("DRAFT" | "ACTIVE" | "ARCHIVED") — display aid. */
  productStatus: string;
  /** Variant image first, else the product's first image, else null. */
  imageUrl: string | null;
  variantSku: string;
  /** ProductVariant.attributes JSON, as stored (e.g. { size: "M" }). */
  variantAttributes: unknown;
  /** The variant's regular price — the "compare at" for the sale. */
  regularPricePoisha: number;
  /** The variant's current stock (denormalized cache on the row). */
  variantStock: number;
  variantIsActive: boolean;
  /** max(0, stockCap - soldCount) — flash stock still available. */
  remaining: number;
}

/** A flash sale whose items carry display data (admin list + live read). */
export interface FlashSaleWithItems extends Omit<FlashSaleRecord, "items"> {
  items: FlashSaleItemDisplay[];
}

/**
 * The currently-live sale for the storefront, or null when none is
 * live. Produced by getLiveFlashSale() in ./repository: isActive,
 * not soft-deleted, startsAt <= now <= endsAt, and at least one item
 * whose product is ACTIVE and variant is purchasable.
 */
export interface LiveFlashSale {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
  items: FlashSaleItemDisplay[];
}

export type FlashSaleStatus = "live" | "upcoming" | "ended" | "inactive";

/** Lifecycle status at an instant. Inactive wins over the time window:
 *  a switched-off sale is never "live", even inside its window. */
export function flashSaleStatus(
  sale: Pick<FlashSaleRecord, "isActive" | "startsAt" | "endsAt">,
  nowIso: string,
): FlashSaleStatus {
  if (!sale.isActive) return "inactive";
  if (nowIso < sale.startsAt) return "upcoming";
  if (nowIso > sale.endsAt) return "ended";
  return "live";
}

export function isFlashSaleLive(
  sale: Pick<FlashSaleRecord, "isActive" | "startsAt" | "endsAt">,
  nowIso: string,
): boolean {
  return flashSaleStatus(sale, nowIso) === "live";
}

/** Flash stock still available for one item. */
export function remainingFlashStock(item: Pick<FlashSaleItemRecord, "stockCap" | "soldCount">): number {
  return Math.max(0, item.stockCap - item.soldCount);
}

/* ------------------------------------------------------------------ */
/* Admin write validation (API routes) lives in ./flash-sale-server   */
/* (zod schemas + FlashSaleInput / FlashSaleItemInput types) so this  */
/* module stays importable from client components.                    */
/* ------------------------------------------------------------------ */
