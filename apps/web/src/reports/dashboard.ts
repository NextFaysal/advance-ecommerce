// Admin dashboard home aggregations — real Prisma queries.
// Replaces the TEMPORARY DEMO aggregations (demo sales rows + mock
// orders + demo inventory). Every figure comes from the DB-backed
// tables; an empty DB yields honest zeros / empty lists, never demo
// numbers. Sales money is summed from order-item rows via the shared
// reports service (stored poisha fields only); order counts are direct
// COUNTs, so orders without items still count as orders.
import { prisma } from "@advance-ecommerce/db";
import { aggregateSales } from "./service";
import { daysAgoInDhaka, fetchSalesRows, todayInDhaka } from "./db-rows";
import { listLowStockDb, listWarehousesDb, LOW_STOCK_THRESHOLD } from "../inventory/repository";
import { getCachedValue, setCachedValue } from "../lib/redis";
import type { LowStockRow } from "../inventory/service";
import type { DateRange, Totals } from "./types";
import type { OrderStatus } from "../orders/types";

export interface DashboardRecentOrder {
  id: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  status: OrderStatus;
  totalPoisha: number;
}

/** One Dhaka calendar day of sales, from the same order-item rows and
 *  with the same status filter (status !== "CANCELLED") as the period
 *  aggregates — the 30 points always sum exactly to `totals`. */
export interface DashboardDailyPoint {
  /** YYYY-MM-DD on the Asia/Dhaka calendar. */
  date: string;
  revenuePoisha: number;
  /** Distinct orders with at least one item that day. */
  orders: number;
}

export interface DashboardData {
  /** Last 30 Dhaka calendar days, inclusive of today. */
  range: DateRange;
  /** Sales totals over `range`, from order-item rows. */
  totals: Totals;
  /** Daily revenue + order counts over `range`, oldest → today. */
  dailySeries: DashboardDailyPoint[];
  today: { revenuePoisha: number; orders: number };
  week: { revenuePoisha: number; orders: number };
  /** All-time (non-deleted) order counts keyed by status. */
  countsByStatus: Partial<Record<OrderStatus, number>>;
  pendingCount: number;
  /** Orders in CONFIRMED / PROCESSING / PACKED with no live Shipment
   *  row yet — the "to ship" work queue (Doc 35 wave 1). */
  toShipCount: number;
  /** Payment rows with status FAILED, all-time like the other pending
   *  counts on this card (Doc 35 wave 1). */
  failedPaymentsCount: number;
  /** ManualTrxSubmission rows still awaiting review (persisted source). */
  pendingTrxReviews: number;
  recentOrders: DashboardRecentOrder[];
  /** Low-stock rows carry the product/variant NAMES (doc 35 wave 3):
   *  the page used to render the raw variantId as the product name,
   *  which an owner cannot act on. `variantLabel` is the attribute
   *  summary ("Size: L, Color: Red"), empty for attribute-less
   *  variants; the ID is demoted to a muted suffix on screen. */
  lowStock: (LowStockRow & {
    warehouseName: string;
    productTitleBn: string;
    productTitleEn: string;
    variantSku: string;
    variantLabel: string;
  })[];
  lowStockThreshold: number;
}

/* ------------------------------------------------------------------ */
/* Cache (perf wave A1)                                                */
/* ------------------------------------------------------------------ */

// The assembled DashboardData is cached for 30 s (TTL approved for
// this wave) through the shared Redis helpers in src/lib/redis.ts —
// the same getCachedValue/setCachedValue pattern the settings module
// uses, including the graceful in-memory fallback when Redis is
// absent or unreachable. Given the same DB state the figures are
// identical to a live computation, modulo this ≤30 s staleness
// window. The key carries the Dhaka date so a post-midnight request
// never serves the previous day's range.
const DASHBOARD_CACHE_TTL_SECONDS = 30;

export async function getDashboardData(): Promise<DashboardData> {
  // Shape changed in doc 35 wave 3 (low-stock rows gained product /
  // variant names) — v3 so a stale v2 entry is never parsed into the
  // new shape.
  const cacheKey = `admin:dashboard:v3:${todayInDhaka()}`;
  try {
    const cached = await getCachedValue(cacheKey);
    if (cached !== null) {
      const parsed = JSON.parse(cached) as DashboardData;
      if (parsed && Array.isArray(parsed.dailySeries) && Array.isArray(parsed.lowStock)) {
        return parsed;
      }
    }
  } catch {
    // An unreadable/corrupt cache entry must never break the
    // dashboard — fall through to the live computation.
  }
  const data = await computeDashboardData();
  try {
    await setCachedValue(cacheKey, JSON.stringify(data), DASHBOARD_CACHE_TTL_SECONDS);
  } catch {
    // Cache writes are best-effort (the helpers already swallow Redis
    // errors; this only guards the serialization step).
  }
  return data;
}

async function computeDashboardData(): Promise<DashboardData> {
  const today = todayInDhaka();
  const range: DateRange = { from: daysAgoInDhaka(29), to: today };
  // Perf wave A1: the sales scan, the status groupBy and the
  // independent lookups previously ran as sequential rounds; they do
  // not depend on each other, so they now run concurrently.
  // (fetchSalesRows keeps its internal orders -> refunds order — a
  // true dependency.) Low stock comes from listLowStockDb (A4),
  // which loads only the below-threshold variants' rows.
  const [rows, grouped, [pendingTrxReviews, toShipCount, failedPaymentsCount, recent, lowStockRead, warehouses]] =
    await Promise.all([
      fetchSalesRows(range),
      prisma.order.groupBy({
        by: ["status"],
        where: { deletedAt: null },
        _count: { _all: true },
      }),
      Promise.all([
        prisma.manualTrxSubmission.count({ where: { status: "PENDING" } }),
        // To ship: fulfilment-ready orders with no live booking yet.
        // The Order.shipments relation is the real link; soft-deleted
        // shipments do not count as a booking.
        prisma.order.count({
          where: {
            deletedAt: null,
            status: { in: ["CONFIRMED", "PROCESSING", "PACKED"] },
            shipments: { none: { deletedAt: null } },
          },
        }),
        // Failed payments: Payment.status is the canonical field
        // (PaymentStatus.FAILED). All-time, matching pendingCount and
        // pendingTrxReviews, which also carry no time window.
        prisma.payment.count({ where: { status: "FAILED", deletedAt: null } }),
        prisma.order.findMany({
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true, orderNo: true, customerName: true, customerPhone: true,
            status: true, totalPoisha: true,
          },
        }),
        listLowStockDb(LOW_STOCK_THRESHOLD),
        listWarehousesDb(),
      ]),
    ]);
  const { items, stockCache } = lowStockRead;
  const totals = aggregateSales(rows, range, false).totals;
  const todayTotals = aggregateSales(rows, { from: today, to: today }, false).totals;
  const weekTotals = aggregateSales(rows, { from: daysAgoInDhaka(6), to: today }, false).totals;

  // Daily series — bucket the SAME rows with the SAME filter
  // aggregateSales uses (status !== "CANCELLED"); a day with no sales
  // rows is a real 0, never omitted, so the chart axis is honest.
  const dayBuckets = new Map<string, { revenuePoisha: number; orderIds: Set<string> }>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const b = dayBuckets.get(r.date) ?? { revenuePoisha: 0, orderIds: new Set<string>() };
    b.revenuePoisha += r.revenuePoisha;
    b.orderIds.add(r.orderId);
    dayBuckets.set(r.date, b);
  }
  const dailySeries: DashboardDailyPoint[] = [];
  for (let i = 29; i >= 0; i--) {
    const date = daysAgoInDhaka(i);
    const b = dayBuckets.get(date);
    dailySeries.push({ date, revenuePoisha: b?.revenuePoisha ?? 0, orders: b?.orderIds.size ?? 0 });
  }

  const countsByStatus: Partial<Record<OrderStatus, number>> = {};
  for (const g of grouped) countsByStatus[g.status as OrderStatus] = g._count._all;

  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  // Doc 18 F1 alignment: low stock is judged on the CANONICAL variant
  // stock cache (ProductVariant.stock — the number checkout claims
  // against), not on Σ InventoryItem.quantityAvailable, which subtracts
  // every reservation twice (the order seam mirrors the post-claim
  // cache into quantityOnHand AND increments quantityReserved). One row
  // per variant: available = cache (fallback Σ available when the
  // variant row is gone), reserved = Σ across warehouses. `items` now
  // holds only the below-threshold variants' rows and `stockCache`
  // the cache for every variant with inventory rows (listLowStockDb),
  // so this assembly — grouping, first row, sums, filter, sort — is
  // byte-for-byte the computation the whole-table load fed.
  const byVariant = new Map<string, (typeof items)[number][]>();
  for (const i of items) {
    const rows = byVariant.get(i.variantId) ?? [];
    rows.push(i);
    byVariant.set(i.variantId, rows);
  }
  const lowStock = [...byVariant.values()]
    .map((rows) => {
      const first = rows[0];
      const available =
        stockCache.get(first.variantId) ?? rows.reduce((s, r) => s + r.quantityAvailable, 0);
      const warehouseIds = [...new Set(rows.map((r) => r.warehouseId))];
      return {
        ...first,
        quantityAvailable: available,
        quantityReserved: rows.reduce((s, r) => s + r.quantityReserved, 0),
        threshold: LOW_STOCK_THRESHOLD,
        isLow: available <= LOW_STOCK_THRESHOLD,
        warehouseName:
          warehouseIds.length > 1
            ? "একাধিক গুদাম"
            : (warehouseName.get(warehouseIds[0]) ?? warehouseIds[0]),
      };
    })
    .filter((r) => r.isLow)
    .sort((a, b) => a.quantityAvailable - b.quantityAvailable);

  // Doc 35 wave 3: resolve the names behind the variant IDs. One
  // batched lookup for just the low-stock variants (a handful of
  // rows); a variant deleted since its inventory rows were written
  // falls back to empty titles and the page renders its SKU/ID.
  const lowStockVariantIds = [...new Set(lowStock.map((r) => r.variantId))];
  const lowStockVariants = lowStockVariantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: lowStockVariantIds } },
        select: {
          id: true,
          sku: true,
          attributes: true,
          product: { select: { titleBn: true, titleEn: true } },
        },
      })
    : [];
  const variantInfo = new Map(lowStockVariants.map((v) => [v.id, v]));
  const lowStockNamed = lowStock.map((r) => {
    const v = variantInfo.get(r.variantId);
    const attrs =
      v && v.attributes && typeof v.attributes === "object" && !Array.isArray(v.attributes)
        ? (v.attributes as Record<string, unknown>)
        : {};
    return {
      ...r,
      productTitleBn: v?.product.titleBn ?? "",
      productTitleEn: v?.product.titleEn ?? "",
      variantSku: v?.sku ?? "",
      variantLabel: Object.entries(attrs)
        .map(([k, val]) => `${k}: ${String(val)}`)
        .join(", "),
    };
  });

  return {
    range,
    totals,
    dailySeries,
    today: { revenuePoisha: todayTotals.revenuePoisha, orders: todayTotals.orders },
    week: { revenuePoisha: weekTotals.revenuePoisha, orders: weekTotals.orders },
    countsByStatus,
    pendingCount: countsByStatus.PENDING ?? 0,
    toShipCount,
    failedPaymentsCount,
    pendingTrxReviews,
    recentOrders: recent.map((o) => ({ ...o, status: o.status as OrderStatus })),
    lowStock: lowStockNamed,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
  };
}
