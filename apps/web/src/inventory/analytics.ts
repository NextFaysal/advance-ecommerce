/**
 * Inventory-depth read models (ADV-20, doc 22): ABC revenue analysis,
 * dead stock, expiring batches, batch overview, serial census.
 *
 * Every figure here is computed from real rows at read time:
 *  - ABC revenue = Σ OrderItem.unitPricePoisha × quantity over orders
 *    that are not CANCELLED and not soft-deleted (a cancelled order
 *    was never revenue; a deleted one is not history either).
 *  - Dead stock uses the CANONICAL availability figure
 *    (ProductVariant.stock, doc-18 F1) and real sale timestamps.
 *  - Expiring batches are the InventoryBatch rows themselves.
 * Nothing is cached or pre-aggregated; a variant/batch that has no
 * rows does not appear (absence = untracked, never a fabricated 0).
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "../lib/settings";
import { addQty, lineTotalPoisha } from "../lib/quantity";

function parseDays(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/* ------------------------------------------------------------------ */
/* ABC analysis                                                        */
/* ------------------------------------------------------------------ */

export interface AbcRow {
  variantId: string;
  sku: string;
  productName: string;
  unitsSold: number;
  revenuePoisha: number;
  /** Share of range revenue in basis points. Σ over rows = 10000. */
  shareBps: number;
  cumulativeShareBps: number;
  abcClass: "A" | "B" | "C";
}

export interface AbcAnalysis {
  rangeDays: number;
  totalRevenuePoisha: number;
  totalUnits: number;
  rows: AbcRow[];
  classSummary: Record<"A" | "B" | "C", { variants: number; revenuePoisha: number; shareBps: number }>;
}

/**
 * ABC by revenue share: sorted by revenue desc; class A covers the
 * head of the curve until cumulative share reaches 70%, B until 90%,
 * C the rest (an item is classified by the cumulative share BEFORE it
 * is added, so the item that crosses a boundary belongs to the class
 * it completes). shareBps are rounded, then the rounding delta is
 * assigned to the largest variant so shares sum to EXACTLY 10000.
 */
export async function getAbcAnalysis(rangeDaysInput?: number): Promise<AbcAnalysis> {
  const rangeDays = rangeDaysInput && rangeDaysInput > 0 ? Math.floor(rangeDaysInput) : 90;
  const since = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
  const items = await prisma.orderItem.findMany({
    where: {
      order: { status: { not: "CANCELLED" }, deletedAt: null, createdAt: { gte: since } },
    },
    select: { variantId: true, sku: true, productName: true, unitPricePoisha: true, quantity: true },
  });

  const byVariant = new Map<string, { sku: string; productName: string; units: number; revenue: number }>();
  let totalRevenue = 0;
  let totalUnits = 0;
  for (const item of items) {
    const revenue = lineTotalPoisha(item.unitPricePoisha, item.quantity);
    totalRevenue += revenue;
    totalUnits = addQty(totalUnits, item.quantity);
    const agg = byVariant.get(item.variantId) ?? {
      sku: item.sku,
      productName: item.productName,
      units: 0,
      revenue: 0,
    };
    agg.units = addQty(agg.units, item.quantity);
    agg.revenue += revenue;
    byVariant.set(item.variantId, agg);
  }

  const sorted = [...byVariant.entries()]
    .map(([variantId, agg]) => ({ variantId, ...agg }))
    .sort((a, b) => b.revenue - a.revenue || a.variantId.localeCompare(b.variantId));

  const rows: AbcRow[] = [];
  const classSummary: AbcAnalysis["classSummary"] = {
    A: { variants: 0, revenuePoisha: 0, shareBps: 0 },
    B: { variants: 0, revenuePoisha: 0, shareBps: 0 },
    C: { variants: 0, revenuePoisha: 0, shareBps: 0 },
  };
  if (totalRevenue > 0) {
    let cumulativeBps = 0;
    let roundingDelta = 10000;
    for (const entry of sorted) {
      const shareBps = Math.round((entry.revenue * 10000) / totalRevenue);
      roundingDelta -= shareBps;
    }
    for (const [index, entry] of sorted.entries()) {
      let shareBps = Math.round((entry.revenue * 10000) / totalRevenue);
      if (index === 0) shareBps += roundingDelta; // largest row absorbs rounding
      const abcClass: AbcRow["abcClass"] =
        cumulativeBps < 7000 ? "A" : cumulativeBps < 9000 ? "B" : "C";
      cumulativeBps += shareBps;
      rows.push({
        variantId: entry.variantId,
        sku: entry.sku,
        productName: entry.productName,
        unitsSold: entry.units,
        revenuePoisha: entry.revenue,
        shareBps,
        cumulativeShareBps: cumulativeBps,
        abcClass,
      });
      const summary = classSummary[abcClass];
      summary.variants += 1;
      summary.revenuePoisha += entry.revenue;
      summary.shareBps += shareBps;
    }
  }
  return { rangeDays, totalRevenuePoisha: totalRevenue, totalUnits, rows, classSummary };
}

/* ------------------------------------------------------------------ */
/* Dead stock                                                          */
/* ------------------------------------------------------------------ */

export interface DeadStockRow {
  variantId: string;
  sku: string;
  productName: string;
  stockOnHand: number;
  costPoisha: number | null;
  /** stock × cost; null when no cost was ever recorded (not faked). */
  stockValuePoisha: number | null;
  /** Last sale in ANY window; null = never sold. */
  lastSaleAt: string | null;
  warehouses: { warehouseId: string; warehouseName: string; onHand: number; bin: string | null }[];
}

export interface DeadStockReport {
  thresholdDays: number;
  rows: DeadStockRow[];
}

/**
 * Dead stock = active variants with canonical stock > 0 and NO sale
 * (non-CANCELLED, non-deleted order) within the threshold window
 * (Settings inventory.dead_stock_days, default 90). Never-sold
 * variants are dead stock by definition and included with
 * lastSaleAt null.
 */
export async function getDeadStock(): Promise<DeadStockReport> {
  const thresholdDays = parseDays(await getSetting("inventory.dead_stock_days").catch(() => undefined), 90);
  const since = new Date(Date.now() - thresholdDays * 24 * 60 * 60 * 1000);

  const stocked = await prisma.productVariant.findMany({
    where: { stock: { gt: 0 }, isActive: true, deletedAt: null },
    select: {
      id: true,
      sku: true,
      stock: true,
      costPoisha: true,
      product: { select: { titleBn: true } },
      inventoryItems: {
        select: {
          warehouseId: true,
          quantityOnHand: true,
          bin: true,
          warehouse: { select: { name: true } },
        },
      },
    },
  });
  if (stocked.length === 0) return { thresholdDays, rows: [] };

  const variantIds = stocked.map((v) => v.id);
  const sales = await prisma.orderItem.findMany({
    where: {
      variantId: { in: variantIds },
      order: { status: { not: "CANCELLED" }, deletedAt: null },
    },
    select: { variantId: true, order: { select: { createdAt: true } } },
  });
  const lastSaleByVariant = new Map<string, Date>();
  const soldInWindow = new Set<string>();
  for (const sale of sales) {
    const at = sale.order.createdAt;
    const prev = lastSaleByVariant.get(sale.variantId);
    if (!prev || at > prev) lastSaleByVariant.set(sale.variantId, at);
    if (at >= since) soldInWindow.add(sale.variantId);
  }

  const rows: DeadStockRow[] = stocked
    .filter((v) => !soldInWindow.has(v.id))
    .map((v) => ({
      variantId: v.id,
      sku: v.sku,
      productName: v.product.titleBn,
      stockOnHand: v.stock,
      costPoisha: v.costPoisha,
      stockValuePoisha: v.costPoisha !== null ? v.stock * v.costPoisha : null,
      lastSaleAt: lastSaleByVariant.get(v.id)?.toISOString() ?? null,
      warehouses: v.inventoryItems.map((row) => ({
        warehouseId: row.warehouseId,
        warehouseName: row.warehouse.name,
        onHand: row.quantityOnHand,
        bin: row.bin,
      })),
    }))
    .sort((a, b) => (b.stockValuePoisha ?? 0) - (a.stockValuePoisha ?? 0));
  return { thresholdDays, rows };
}

/* ------------------------------------------------------------------ */
/* Batches: expiring soon + overview                                   */
/* ------------------------------------------------------------------ */

export interface BatchRow {
  batchId: string;
  batchCode: string;
  variantId: string;
  sku: string;
  productName: string;
  warehouseId: string;
  warehouseName: string;
  bin: string | null;
  quantityOnHand: number;
  expiryDate: string | null;
  /** Negative = already expired. Null = no expiry recorded. */
  daysUntilExpiry: number | null;
  purchaseOrderId: string | null;
}

function toBatchRow(batch: {
  id: string;
  batchCode: string;
  variantId: string;
  warehouseId: string;
  bin: string | null;
  quantityOnHand: number;
  expiryDate: Date | null;
  purchaseOrderId: string | null;
  variant: { sku: string; product: { titleBn: string } };
  warehouse: { name: string };
}): BatchRow {
  return {
    batchId: batch.id,
    batchCode: batch.batchCode,
    variantId: batch.variantId,
    sku: batch.variant.sku,
    productName: batch.variant.product.titleBn,
    warehouseId: batch.warehouseId,
    warehouseName: batch.warehouse.name,
    bin: batch.bin,
    quantityOnHand: batch.quantityOnHand,
    expiryDate: batch.expiryDate?.toISOString() ?? null,
    daysUntilExpiry:
      batch.expiryDate === null
        ? null
        : Math.floor((batch.expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    purchaseOrderId: batch.purchaseOrderId,
  };
}

const BATCH_SELECT = {
  id: true,
  batchCode: true,
  variantId: true,
  warehouseId: true,
  bin: true,
  quantityOnHand: true,
  expiryDate: true,
  purchaseOrderId: true,
  variant: { select: { sku: true, product: { select: { titleBn: true } } } },
  warehouse: { select: { name: true } },
} as const;

export interface ExpiringReport {
  warningDays: number;
  rows: BatchRow[];
}

/**
 * Batches with stock on hand whose expiry falls within the warning
 * window (Settings inventory.expiry_warning_days, default 30 —
 * doc 22's acceptance horizon). Already-expired batches with stock
 * are included (they are the most urgent) and sort first.
 */
export async function getExpiringBatches(): Promise<ExpiringReport> {
  const warningDays = parseDays(await getSetting("inventory.expiry_warning_days").catch(() => undefined), 30);
  const cutoff = new Date(Date.now() + warningDays * 24 * 60 * 60 * 1000);
  const batches = await prisma.inventoryBatch.findMany({
    where: { quantityOnHand: { gt: 0 }, expiryDate: { not: null, lte: cutoff } },
    orderBy: [{ expiryDate: "asc" }],
    select: BATCH_SELECT,
    take: 200,
  });
  return { warningDays, rows: batches.map(toBatchRow) };
}

/** All batches still holding stock (the lot ledger as recorded). */
export async function getBatchOverview(): Promise<BatchRow[]> {
  const batches = await prisma.inventoryBatch.findMany({
    where: { quantityOnHand: { gt: 0 } },
    orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    select: BATCH_SELECT,
    take: 200,
  });
  return batches.map(toBatchRow);
}

/* ------------------------------------------------------------------ */
/* Serial census                                                       */
/* ------------------------------------------------------------------ */

export interface SerialSummary {
  inStock: number;
  sold: number;
  returned: number;
  total: number;
}

export async function getSerialSummary(): Promise<SerialSummary> {
  const grouped = await prisma.serialUnit.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
  const inStock = byStatus.get("IN_STOCK") ?? 0;
  const sold = byStatus.get("SOLD") ?? 0;
  const returned = byStatus.get("RETURNED") ?? 0;
  return { inStock, sold, returned, total: inStock + sold + returned };
}

/* ------------------------------------------------------------------ */
/* Combined report for the admin panel                                 */
/* ------------------------------------------------------------------ */

export async function getInventoryDepthReport(rangeDays?: number) {
  const [abc, deadStock, expiring, batches, serials] = await Promise.all([
    getAbcAnalysis(rangeDays),
    getDeadStock(),
    getExpiringBatches(),
    getBatchOverview(),
    getSerialSummary(),
  ]);
  return { abc, deadStock, expiring, batches, serials };
}
