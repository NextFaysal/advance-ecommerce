// Advanced inventory — Agent 16, Step 48 (A11). Pure logic + types.
// Stock itself still changes ONLY via the stock_movements ledger
// (src/inventory); these helpers plan and validate, they never edit stock.
import { z } from "zod";

// ---- Multi-warehouse transfer ----

export type TransferStatus = "DRAFT" | "IN_TRANSIT" | "RECEIVED" | "CANCELLED";

export const transferLineSchema = z.object({
  variantId: z.string().min(1),
  sku: z.string().min(1),
  quantity: z.number().int().positive(),
});
export type TransferLine = z.infer<typeof transferLineSchema>;

export interface StockTransfer {
  id: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  lines: TransferLine[];
  status: TransferStatus;
  createdAt: string;
  dispatchedAt?: string;
  receivedAt?: string;
}

const TRANSFER_TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  DRAFT: ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

/** While IN_TRANSIT, units exist in neither warehouse's available stock:
 *  transfer_out at dispatch, transfer_in at receive (ledger types already exist). */
export function transferTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSFER_TRANSITIONS[from].includes(to);
}

// ---- Batch / expiry (FEFO) ----

export type StockBatch = {
  batchId: string;
  variantId: string;
  warehouseId: string;
  quantity: number;
  /** ISO date; null = non-perishable batch, always picked last. */
  expiryDate: string | null;
  receivedAt: string;
};

export type FefoPick = { batchId: string; quantity: number };

/** First-Expired-First-Out pick plan. Insufficient stock -> the shortfall is
 *  reported, never silently under-picked. */
export function fefoPickOrder(
  batches: readonly StockBatch[], variantId: string, warehouseId: string, qty: number,
): { picks: FefoPick[]; shortfall: number } {
  const eligible = batches
    .filter((b) => b.variantId === variantId && b.warehouseId === warehouseId && b.quantity > 0)
    .sort((a, b) => {
      if (a.expiryDate === null && b.expiryDate === null) return a.receivedAt.localeCompare(b.receivedAt);
      if (a.expiryDate === null) return 1;
      if (b.expiryDate === null) return -1;
      return a.expiryDate.localeCompare(b.expiryDate) || a.receivedAt.localeCompare(b.receivedAt);
    });
  const picks: FefoPick[] = [];
  let need = qty;
  for (const batch of eligible) {
    if (need <= 0) break;
    const take = Math.min(batch.quantity, need);
    picks.push({ batchId: batch.batchId, quantity: take });
    need -= take;
  }
  return { picks, shortfall: need };
}

export function isBatchExpired(batch: StockBatch, onDateIso: string): boolean {
  return batch.expiryDate !== null && batch.expiryDate < onDateIso;
}

// ---- Serial / IMEI tracking ----

export type SerialStatus = "IN_STOCK" | "RESERVED" | "SOLD" | "RETURNED" | "DAMAGED";

export type SerialUnit = {
  serial: string; // IMEI or serial number, stored as supplied (identifier, not a secret)
  variantId: string;
  warehouseId: string;
  status: SerialStatus;
  orderId?: string;
};

export function findDuplicateSerials(units: readonly SerialUnit[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const u of units) {
    if (seen.has(u.serial)) dupes.add(u.serial);
    seen.add(u.serial);
  }
  return [...dupes];
}

// ---- Forecast ----

export type SalesVelocity = {
  variantId: string;
  /** Total units sold in the lookback window. */
  unitsSold: number;
  windowDays: number;
  quantityAvailable: number;
  leadTimeDays: number;
  safetyDays: number;
};

export type ForecastResult = {
  variantId: string;
  /** Hundredths of a unit per day, integer math: unitsSold * 100 / windowDays. */
  dailyRateHundredths: number;
  /** Whole days of stock left at the current rate; null when there is no sales rate. */
  daysOfStock: number | null;
  reorderPoint: number;
  needsReorder: boolean;
};

export function forecastStock(v: SalesVelocity): ForecastResult {
  const dailyRateHundredths = v.windowDays > 0 ? Math.round((v.unitsSold * 100) / v.windowDays) : 0;
  const daysOfStock = dailyRateHundredths > 0
    ? Math.floor((v.quantityAvailable * 100) / dailyRateHundredths)
    : null;
  // reorderPoint = ceil(dailyRate * (leadTime + safety)) using integer hundredths.
  const reorderPoint = Math.ceil((dailyRateHundredths * (v.leadTimeDays + v.safetyDays)) / 100);
  return {
    variantId: v.variantId,
    dailyRateHundredths,
    daysOfStock,
    reorderPoint,
    needsReorder: dailyRateHundredths > 0 && v.quantityAvailable <= reorderPoint,
  };
}

// ---- Supplier price comparison ----

export type SupplierQuote = {
  supplierId: string;
  supplierName: string;
  variantId: string;
  costPoisha: number;
  moq: number;
  leadTimeDays: number;
};

export type SupplierComparison = {
  variantId: string;
  cheapest: SupplierQuote;
  mostExpensivePoisha: number;
  savingsVsDearestPoisha: number;
  quotes: SupplierQuote[]; // sorted by cost, then lead time
};

export function compareSupplierQuotes(quotes: readonly SupplierQuote[], variantId: string): SupplierComparison | null {
  const relevant = quotes
    .filter((q) => q.variantId === variantId)
    .sort((a, b) => a.costPoisha - b.costPoisha || a.leadTimeDays - b.leadTimeDays);
  if (relevant.length === 0) return null;
  const cheapest = relevant[0] as SupplierQuote;
  const dearest = relevant[relevant.length - 1] as SupplierQuote;
  return {
    variantId,
    cheapest,
    mostExpensivePoisha: dearest.costPoisha,
    savingsVsDearestPoisha: dearest.costPoisha - cheapest.costPoisha,
    quotes: relevant,
  };
}
