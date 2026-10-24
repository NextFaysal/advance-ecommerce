/**
 * Marketing repository — DB-backed persistence (Prisma) for coupons
 * and campaigns.
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
