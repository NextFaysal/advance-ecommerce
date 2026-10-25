/**
 * Marketing repository — DB-backed persistence (Prisma) for coupons,
 * campaigns and flash sales (flash-sale section at the bottom).
 *
 * COUPONS: definitions live in the Coupon table; usage lives in
 * CouponUsage (written by the orders create transaction — see
 * src/orders/repository.ts — with the schema's
 * @@unique([couponId, orderId]) as the exactly-once backstop;
 * recordCouponUsageDb() below exposes the same write for other
 * callers and treats a duplicate as a no-op replay).
 *
 * A CouponRecord (the shape applyCoupon() consumes) is assembled from
 * the Coupon row + usage aggregates: usedCount = CouponUsage count,
 * usedByUser = per-customer counts. DRIFT: checkout identifies the
 * per-user key by normalized PHONE (guest checkout), while CouponUsage
 * keys by Customer id — the aggregates therefore record each usage
 * under BOTH the customer id and the customer's phone, so the
 * per-user limit check works with either key. There is no phone
 * column on CouponUsage; the phone comes from the Customer relation.
 *
 * SYNC SNAPSHOT: evaluateOrderCoupon() (src/checkout/order-enrichment)
 * is a synchronous contract inside the public order-create flow, so it
 * cannot await a DB read per order. This module keeps a process-level
 * snapshot of DB coupon records (refreshed on module load, on every
 * admin coupon write, and from instrumentation at server start) and
 * checkout consults the snapshot FIRST, then the legacy in-memory
 * store, then the seed-mirroring demo records. A coupon created via
 * the admin API is upserted into the snapshot in the same request, so
 * it is evaluable immediately; after a restart the snapshot reloads
 * usage counts from CouponUsage, so limits survive restarts.
 *
 * CAMPAIGNS: definitions persist to the Campaign table. DRIFT: the TS
 * Campaign shape carries recipientCount, but the Campaign table has
 * NO recipientCount column — created campaigns echo the submitted
 * recipientCount in the create response only; list reads report 0
 * (nothing is invented). TS status also has "cancelled", which the
 * schema enum lacks (DRAFT/SCHEDULED/SENDING/SENT/COMPLETED); a
 * COMPLETED row reads back as "completed" via cast (the runtime
 * string is truthful, the TS union is narrower — same convention as
 * orders/repository payment methods).
 */
import { prisma } from "@advance-ecommerce/db";
import type { Campaign } from "./campaign";
import type { CouponInput } from "./coupon";
import type {
  FlashSaleInput,
  FlashSaleItemDisplay,
  FlashSaleWithItems,
  LiveFlashSale,
} from "./flash-sale";
import type { CouponRecord, CreateCampaignInput } from "./service";

/* ------------------------------------------------------------------ */
/* Enum mapping (TS domain <-> Prisma schema)                          */
/* ------------------------------------------------------------------ */

const COUPON_TYPE_TO_DB: Record<CouponRecord["type"], string> = {
  percent: "PERCENT",
  fixed: "FIXED",
  free_shipping: "FREE_SHIPPING",
  first_order: "FIRST_ORDER",
};

const COUPON_TYPE_FROM_DB: Record<string, CouponRecord["type"]> = {
  PERCENT: "percent",
  FIXED: "fixed",
  FREE_SHIPPING: "free_shipping",
  FIRST_ORDER: "first_order",
};

const CAMPAIGN_CHANNEL_TO_DB: Record<Campaign["channel"], string> = {
  sms: "SMS",
  email: "EMAIL",
};

const CAMPAIGN_CHANNEL_FROM_DB: Record<string, Campaign["channel"]> = {
  SMS: "sms",
  EMAIL: "email",
};

const CAMPAIGN_STATUS_FROM_DB: Record<string, Campaign["status"]> = {
  DRAFT: "draft",
  SCHEDULED: "scheduled",
  SENDING: "sending",
  SENT: "sent",
  // No TS "completed" in the union; cast keeps the runtime string true.
  COMPLETED: "completed" as Campaign["status"],
};

/* ------------------------------------------------------------------ */
/* Coupon rows -> CouponRecord                                         */
/* ------------------------------------------------------------------ */

interface CouponUsageAggregate {
  count: number;
  byUser: Record<string, number>;
}

async function loadUsageAggregates(couponIds: string[]): Promise<Map<string, CouponUsageAggregate>> {
  const out = new Map<string, CouponUsageAggregate>();
  if (couponIds.length === 0) return out;
  const usages = await prisma.couponUsage.findMany({
    where: { couponId: { in: couponIds } },
    select: {
      couponId: true,
      customerId: true,
      customer: { select: { phone: true } },
    },
  });
  for (const u of usages) {
    let agg = out.get(u.couponId);
    if (!agg) {
      agg = { count: 0, byUser: {} };
      out.set(u.couponId, agg);
    }
    agg.count += 1;
    if (u.customerId) agg.byUser[u.customerId] = (agg.byUser[u.customerId] ?? 0) + 1;
    if (u.customer?.phone) agg.byUser[u.customer.phone] = (agg.byUser[u.customer.phone] ?? 0) + 1;
  }
  return out;
}

type CouponRow = NonNullable<Awaited<ReturnType<typeof prisma.coupon.findFirst>>>;

export function couponRowToRecord(
  row: CouponRow,
  agg: CouponUsageAggregate = { count: 0, byUser: {} },
): CouponRecord {
  return {
    id: row.id,
    code: row.code,
    type: COUPON_TYPE_FROM_DB[row.type] ?? "fixed",
    valuePercent: row.valuePercent,
    valuePoisha: row.valuePoisha,
    minCartPoisha: row.minCartPoisha,
    maxDiscountPoisha: row.maxDiscountPoisha,
    usageLimit: row.usageLimit,
    perUserLimit: row.perUserLimit,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    stackable: row.stackable,
    isActive: row.isActive,
    usedCount: agg.count,
    usedByUser: agg.byUser,
  };
}

export async function listCouponsDb(): Promise<CouponRecord[]> {
  const rows = await prisma.coupon.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  const aggregates = await loadUsageAggregates(rows.map((r) => r.id));
  return rows.map((r) => couponRowToRecord(r, aggregates.get(r.id)));
}

export async function findCouponByCodeDb(code: string): Promise<CouponRecord | null> {
  const row = await prisma.coupon.findFirst({
    where: { code: code.trim().toUpperCase(), deletedAt: null },
  });
  if (!row) return null;
  const aggregates = await loadUsageAggregates([row.id]);
  return couponRowToRecord(row, aggregates.get(row.id));
}

export async function createCouponDb(input: CouponInput): Promise<CouponRecord> {
  const row = await prisma.coupon.create({
    data: {
      code: input.code,
      type: COUPON_TYPE_TO_DB[input.type] as never,
      valuePercent: input.valuePercent,
      valuePoisha: input.valuePoisha,
      minCartPoisha: input.minCartPoisha,
      maxDiscountPoisha: input.maxDiscountPoisha,
      usageLimit: input.usageLimit,
      perUserLimit: input.perUserLimit,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      stackable: input.stackable,
      isActive: input.isActive,
    },
  });
  const record = couponRowToRecord(row);
  upsertCouponInSnapshot(record);
  return record;
}

/** Toggles a coupon's isActive flag. Returns null when the coupon
 *  does not exist (or is soft-deleted). The checkout snapshot is kept
 *  in sync so the change is evaluable at checkout immediately, exactly
 *  like createCouponDb. */
export async function setCouponActiveDb(id: string, isActive: boolean): Promise<CouponRecord | null> {
  const existing = await prisma.coupon.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return null;
  const row = await prisma.coupon.update({ where: { id }, data: { isActive } });
  const aggregates = await loadUsageAggregates([id]);
  const record = couponRowToRecord(row, aggregates.get(id));
  upsertCouponInSnapshot(record);
  return record;
}

/**
 * Writes one CouponUsage row for (couponId, orderId). The schema's
 * @@unique([couponId, orderId]) makes a second write for the same
 * order impossible; a replay returns { created: false } instead of
 * double-counting. This is the same write the orders create
 * transaction performs — exposed here for module-level callers/tests.
 */
export async function recordCouponUsageDb(input: {
  couponId: string;
  orderId: string;
  customerId?: string | null;
  discountPoisha: number;
}): Promise<{ created: boolean }> {
  try {
    await prisma.couponUsage.create({
      data: {
        couponId: input.couponId,
        orderId: input.orderId,
        customerId: input.customerId ?? null,
        discountPoisha: input.discountPoisha,
      },
    });
    return { created: true };
  } catch (e) {
    if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
      return { created: false };
    }
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/* Sync snapshot for the (synchronous) checkout evaluation contract    */
/* ------------------------------------------------------------------ */

let snapshot: CouponRecord[] = [];

export function couponSnapshot(): readonly CouponRecord[] {
  return snapshot;
}

export function findCouponInSnapshot(code: string): CouponRecord | null {
  const normalized = code.trim().toUpperCase();
  return snapshot.find((c) => c.code === normalized) ?? null;
}

export function upsertCouponInSnapshot(record: CouponRecord): void {
  const idx = snapshot.findIndex((c) => c.code === record.code);
  if (idx >= 0) snapshot[idx] = record;
  else snapshot.push(record);
}

/** Reloads the snapshot from the DB. Never throws — on a DB failure
 *  the previous snapshot (possibly the empty initial one) stays in
 *  place and checkout falls back to the legacy stores, exactly the
 *  pre-swap behaviour. */
export async function refreshCouponSnapshot(): Promise<void> {
  try {
    snapshot = await listCouponsDb();
  } catch {
    // DB unreachable at this moment; keep the current snapshot.
  }
}

// Warm the snapshot at module load on the server (routes and the
// enrichment module import this repository server-side only).
if (typeof window === "undefined") {
  void refreshCouponSnapshot();
}

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

type CampaignRow = NonNullable<Awaited<ReturnType<typeof prisma.campaign.findFirst>>>;

function campaignRowToCampaign(row: CampaignRow, recipientCount = 0): Campaign {
  return {
    id: row.id,
    channel: CAMPAIGN_CHANNEL_FROM_DB[row.channel] ?? "sms",
    segmentRef: row.segmentRef ?? "",
    templateKey: row.templateKey ?? "",
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    recipientCount,
    sentCount: row.sentCount,
    deliveredCount: row.deliveredCount,
    failedCount: row.failedCount,
    costEstimatePoisha: row.costEstimatePoisha,
    status: CAMPAIGN_STATUS_FROM_DB[row.status] ?? "draft",
  };
}

export async function listCampaignsDb(): Promise<Campaign[]> {
  const rows = await prisma.campaign.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  // recipientCount is not a column (see header drift) — reported as 0.
  return rows.map((r) => campaignRowToCampaign(r));
}

export async function createCampaignDb(
  input: CreateCampaignInput,
  costEstimatePoisha: number,
): Promise<Campaign> {
  const row = await prisma.campaign.create({
    data: {
      channel: CAMPAIGN_CHANNEL_TO_DB[input.channel] as never,
      segmentRef: input.segmentRef,
      templateKey: input.templateKey,
      scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
      costEstimatePoisha,
      status: input.scheduledAt ? "SCHEDULED" : "DRAFT",
    },
  });
  // The create response echoes the submitted recipientCount; it is not
  // persisted (no column) — see header drift note.
  return campaignRowToCampaign(row, input.recipientCount);
}

/* ------------------------------------------------------------------ */
/* Flash sales                                                         */
/* ------------------------------------------------------------------ */
/**
 * FLASH SALES: definitions live in FlashSale + FlashSaleItem (the
 * schema puts salePricePoisha/stockCap/soldCount on the ITEM, keyed
 * by variant, @@unique([flashSaleId, variantId])). Reads assemble the
 * display shape (product titles/slug/image + variant sku/regular
 * price) in one include — no N+1. Writes replace the item set
 * wholesale inside a transaction; soldCount is never writable through
 * this module (the order path owns it). Deletes are soft (deletedAt),
 * matching Coupon/Campaign. The variant is the source of truth for
 * productId: a create/update payload may omit productId, and a
 * supplied value that disagrees with the variant's product is
 * rejected ("variant_product_mismatch").
 */

const flashSaleInclude = {
  items: {
    orderBy: { createdAt: "asc" as const },
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: "asc" as const }, take: 1 },
        },
      },
      variant: true,
    },
  },
};

/** Structural minimum of a FlashSaleItem row with product+variant
 *  included — declared locally so both the plain and the filtered
 *  (live-read) includes can feed the same mapper. */
interface FlashSaleItemRowLike {
  id: string;
  flashSaleId: string;
  productId: string;
  variantId: string;
  salePricePoisha: number;
  stockCap: number;
  soldCount: number;
  createdAt: Date;
  product: {
    titleBn: string;
    titleEn: string;
    slug: string;
    status: string;
    images: { url: string }[];
  };
  variant: {
    sku: string;
    attributes: unknown;
    pricePoisha: number;
    stock: number;
    imageUrl: string | null;
    isActive: boolean;
  };
}

interface FlashSaleRowLike {
  id: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  items: FlashSaleItemRowLike[];
}

function flashSaleItemRowToDisplay(item: FlashSaleItemRowLike): FlashSaleItemDisplay {
  return {
    id: item.id,
    flashSaleId: item.flashSaleId,
    productId: item.productId,
    variantId: item.variantId,
    salePricePoisha: item.salePricePoisha,
    stockCap: item.stockCap,
    soldCount: item.soldCount,
    createdAt: item.createdAt.toISOString(),
    productTitleBn: item.product.titleBn,
    productTitleEn: item.product.titleEn,
    productSlug: item.product.slug,
    productStatus: item.product.status,
    imageUrl: item.variant.imageUrl ?? item.product.images[0]?.url ?? null,
    variantSku: item.variant.sku,
    variantAttributes: item.variant.attributes,
    regularPricePoisha: item.variant.pricePoisha,
    variantStock: item.variant.stock,
    variantIsActive: item.variant.isActive,
    remaining: Math.max(0, item.stockCap - item.soldCount),
  };
}

function flashSaleRowToWithItems(row: FlashSaleRowLike): FlashSaleWithItems {
  return {
    id: row.id,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    items: row.items.map(flashSaleItemRowToDisplay),
  };
}

async function loadFlashSaleById(id: string): Promise<FlashSaleWithItems | null> {
  const row = await prisma.flashSale.findFirst({
    where: { id, deletedAt: null },
    include: flashSaleInclude,
  });
  return row ? flashSaleRowToWithItems(row) : null;
}

export async function listFlashSalesDb(): Promise<FlashSaleWithItems[]> {
  const rows = await prisma.flashSale.findMany({
    where: { deletedAt: null },
    orderBy: { startsAt: "desc" },
    include: flashSaleInclude,
  });
  return rows.map(flashSaleRowToWithItems);
}

export async function getFlashSaleDb(id: string): Promise<FlashSaleWithItems | null> {
  return loadFlashSaleById(id);
}

/**
 * Resolves each input item's variant to its product. Throws
 * Error("variant_not_found") for an unknown/soft-deleted variant and
 * Error("variant_product_mismatch") when a supplied productId
 * disagrees — routes map these to 400s; anything else propagates.
 */
async function resolveFlashSaleItems(
  items: FlashSaleInput["items"],
): Promise<{ productId: string; variantId: string; salePricePoisha: number; stockCap: number }[]> {
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: items.map((i) => i.variantId) }, deletedAt: null },
    select: { id: true, productId: true },
  });
  const productByVariant = new Map(variants.map((v) => [v.id, v.productId]));
  return items.map((item) => {
    const productId = productByVariant.get(item.variantId);
    if (!productId) throw new Error("variant_not_found");
    if (item.productId !== undefined && item.productId !== productId) {
      throw new Error("variant_product_mismatch");
    }
    return {
      productId,
      variantId: item.variantId,
      salePricePoisha: item.salePricePoisha,
      stockCap: item.stockCap,
    };
  });
}

export async function createFlashSaleDb(input: FlashSaleInput): Promise<FlashSaleWithItems> {
  const items = await resolveFlashSaleItems(input.items);
  const row = await prisma.flashSale.create({
    data: {
      name: input.name,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      isActive: input.isActive,
      items: { create: items },
    },
  });
  const created = await loadFlashSaleById(row.id);
  if (!created) throw new Error("flash_sale_create_failed");
  return created;
}

/** Full replace: fields + the whole item set, in one transaction.
 *  Returns null when the sale does not exist (or is soft-deleted). */
export async function updateFlashSaleDb(
  id: string,
  input: FlashSaleInput,
): Promise<FlashSaleWithItems | null> {
  const existing = await prisma.flashSale.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;
  const items = await resolveFlashSaleItems(input.items);
  await prisma.$transaction([
    prisma.flashSale.update({
      where: { id },
      data: {
        name: input.name,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        isActive: input.isActive,
      },
    }),
    prisma.flashSaleItem.deleteMany({ where: { flashSaleId: id } }),
    prisma.flashSaleItem.createMany({
      data: items.map((item) => ({ flashSaleId: id, ...item })),
    }),
  ]);
  return loadFlashSaleById(id);
}

export async function setFlashSaleActiveDb(
  id: string,
  isActive: boolean,
): Promise<FlashSaleWithItems | null> {
  const existing = await prisma.flashSale.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.flashSale.update({ where: { id }, data: { isActive } });
  return loadFlashSaleById(id);
}

/** Soft delete (deletedAt). Returns false when missing/already deleted. */
export async function deleteFlashSaleDb(id: string): Promise<boolean> {
  const result = await prisma.flashSale.updateMany({
    where: { id, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return result.count > 0;
}

/**
 * The storefront live read: the soonest-ending sale that is active,
 * not soft-deleted and inside its window at `now`, with only
 * purchasable items attached (product ACTIVE + not deleted, variant
 * active + not deleted). Returns null when no sale is live — or when
 * the live sale has no purchasable item left to show.
 */
export async function getLiveFlashSale(now: Date = new Date()): Promise<LiveFlashSale | null> {
  const row = await prisma.flashSale.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    orderBy: { endsAt: "asc" },
    include: {
      items: {
        where: {
          product: { status: "ACTIVE", deletedAt: null },
          variant: { isActive: true, deletedAt: null },
        },
        orderBy: { createdAt: "asc" },
        include: {
          product: {
            include: {
              images: { orderBy: { sortOrder: "asc" }, take: 1 },
            },
          },
          variant: true,
        },
      },
    },
  });
  if (!row || row.items.length === 0) return null;
  const withItems = flashSaleRowToWithItems(row);
  return {
    id: withItems.id,
    name: withItems.name,
    startsAt: withItems.startsAt,
    endsAt: withItems.endsAt,
    items: withItems.items,
  };
}
