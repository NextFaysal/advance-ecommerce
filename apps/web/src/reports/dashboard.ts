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

export interface DashboardData {
  /** Last 30 Dhaka calendar days, inclusive of today. */
  range: DateRange;
  /** Sales totals over `range`, from order-item rows. */
  totals: Totals;
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
