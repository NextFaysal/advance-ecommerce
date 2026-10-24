// In-memory DEMO store — Agent 16. TEMPORARY: replaced by Prisma-backed
// repositories behind these same shapes once Prisma generate succeeds.
// Demo rows are labelled SAMPLE so they can never be mistaken for real data.
import type { PreOrder } from "./types";
import type { StockTransfer } from "./inventory-advanced";

class DemoAdvancedOrderStore {
  private preOrders: PreOrder[] = [
    {
      id: "pre_demo_1", productVariantId: "var_demo_1", sku: "SAMPLE-PRE-001",
      customerPhone: "+8801700000000", quantity: 2, unitPricePoisha: 250000,
      depositPoisha: 50000, expectedDate: "2026-11-15", status: "OPEN",
      fulfilledQty: 0, createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];
  private transfers: StockTransfer[] = [];

  listPreOrders(): PreOrder[] { return [...this.preOrders]; }
  addPreOrder(pre: PreOrder): PreOrder { this.preOrders.push(pre); return pre; }
  replacePreOrder(pre: PreOrder): void {
    this.preOrders = this.preOrders.map((p) => (p.id === pre.id ? pre : p));
  }
  listTransfers(): StockTransfer[] { return [...this.transfers]; }
  addTransfer(t: StockTransfer): StockTransfer { this.transfers.push(t); return t; }
}

/** Shared demo instance used by the advanced-orders API routes. */
export const demoAdvancedOrderStore = new DemoAdvancedOrderStore();
