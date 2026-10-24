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
import { listInventoryItemsDb, listWarehousesDb, LOW_STOCK_THRESHOLD } from "../inventory/repository";
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
  /** ManualTrxSubmission rows still awaiting review (persisted source). */
  pendingTrxReviews: number;
  recentOrders: DashboardRecentOrder[];
  lowStock: (LowStockRow & { warehouseName: string })[];
  lowStockThreshold: number;
}

export async function getDashboardData(): Promise<DashboardData> {
  const today = todayInDhaka();
  const range: DateRange = { from: daysAgoInDhaka(29), to: today };
  const rows = await fetchSalesRows(range);
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

  const grouped = await prisma.order.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const countsByStatus: Partial<Record<OrderStatus, number>> = {};
  for (const g of grouped) countsByStatus[g.status as OrderStatus] = g._count._all;

  const [pendingTrxReviews, recent, items, warehouses] = await Promise.all([
    prisma.manualTrxSubmission.count({ where: { status: "PENDING" } }),
    prisma.order.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, orderNo: true, customerName: true, customerPhone: true,
        status: true, totalPoisha: true,
      },
    }),
    listInventoryItemsDb(),
    listWarehousesDb(),
  ]);

  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  const lowStock = items
    .map((i) => ({
      ...i,
      threshold: LOW_STOCK_THRESHOLD,
      isLow: i.quantityAvailable <= LOW_STOCK_THRESHOLD,
      warehouseName: warehouseName.get(i.warehouseId) ?? i.warehouseId,
    }))
    .filter((r) => r.isLow)
    .sort((a, b) => a.quantityAvailable - b.quantityAvailable);

  return {
    range,
    totals,
    dailySeries,
    today: { revenuePoisha: todayTotals.revenuePoisha, orders: todayTotals.orders },
    week: { revenuePoisha: weekTotals.revenuePoisha, orders: weekTotals.orders },
    countsByStatus,
    pendingCount: countsByStatus.PENDING ?? 0,
    pendingTrxReviews,
    recentOrders: recent.map((o) => ({ ...o, status: o.status as OrderStatus })),
    lowStock,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
  };
}
