// Advanced-orders store — Agent 16 interface, DB-backed since 2026-10-24.
//
// Persistence lives behind this interface; the runtime store is
// PrismaAdvancedOrderStore in ./db-store.ts (shared instance:
// `advancedOrderStore`, used by the advanced-orders API routes). The
// interface is async: the previous sync contract was the demo store's
// shape, and every runtime consumer (API routes) is async already.
//
// The in-memory implementations stay for tests/fixtures and for the
// admin page playground, which still renders demo rows synchronously
// through `demoAdvancedOrderStore` (SAMPLE rows included) until the UI
// wiring moves it to the API.
//
// This file must NEVER import Prisma: the advanced-orders client
// component imports this module's index for pure functions, and Prisma
// in a client bundle breaks the production build.
import type { PreOrder } from "./types";
import type { StockTransfer } from "./inventory-advanced";

export interface AdvancedOrderStore {
  listPreOrders(): Promise<PreOrder[]>;
  addPreOrder(pre: PreOrder): Promise<PreOrder>;
  replacePreOrder(pre: PreOrder): Promise<void>;
  listTransfers(): Promise<StockTransfer[]>;
  addTransfer(t: StockTransfer): Promise<StockTransfer>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryAdvancedOrderStore implements AdvancedOrderStore {
  private preOrders: PreOrder[] = [
    {
      id: "pre_demo_1", productVariantId: "var_demo_1", sku: "SAMPLE-PRE-001",
      customerPhone: "+8801700000000", quantity: 2, unitPricePoisha: 250000,
      depositPoisha: 50000, expectedDate: "2026-11-15", status: "OPEN",
      fulfilledQty: 0, createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];
  private transfers: StockTransfer[] = [];

  async listPreOrders(): Promise<PreOrder[]> { return [...this.preOrders]; }
  async addPreOrder(pre: PreOrder): Promise<PreOrder> { this.preOrders.push(pre); return pre; }
  async replacePreOrder(pre: PreOrder): Promise<void> {
    this.preOrders = this.preOrders.map((p) => (p.id === pre.id ? pre : p));
  }
  async listTransfers(): Promise<StockTransfer[]> { return [...this.transfers]; }
  async addTransfer(t: StockTransfer): Promise<StockTransfer> { this.transfers.push(t); return t; }
}

/* ------------------------------------------------------------------ */
/* Sync demo facade for the admin page playground (unchanged contract)  */
/* ------------------------------------------------------------------ */

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

/** Shared demo instance used by the admin advanced-orders page only. */
export const demoAdvancedOrderStore = new DemoAdvancedOrderStore();
