// B2B store — Agent 16 interface, DB-backed since 2026-10-24.
//
// Persistence lives behind this interface; the runtime store is
// PrismaB2bStore in ./db-store.ts (shared instance: `b2bStore`, used by
// the B2B API routes). The in-memory implementations stay for tests and
// for the admin page playground, which still renders demo rows
// synchronously through `demoB2bStore` until the UI wiring moves it to
// the API. This file must NEVER import Prisma (client-bundle safety).
import type { B2bCustomer, Quotation } from "./types";

export interface B2bStore {
  listCustomers(): Promise<B2bCustomer[]>;
  getCustomer(id: string): Promise<B2bCustomer | undefined>;
  replaceCustomer(c: B2bCustomer): Promise<void>;
  listQuotations(): Promise<Quotation[]>;
  getQuotation(id: string): Promise<Quotation | undefined>;
  addQuotation(q: Quotation): Promise<Quotation>;
  replaceQuotation(q: Quotation): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryB2bStore implements B2bStore {
  private customers: B2bCustomer[] = [
    {
      id: "b2b_demo_1", businessName: "SAMPLE Wholesale Traders", contactName: "Demo Contact",
      phone: "+8801700000000", approvalStatus: "PENDING", creditLimitPoisha: 50000000,
      outstandingPoisha: 0, createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];
  private quotations: Quotation[] = [];

  async listCustomers(): Promise<B2bCustomer[]> { return [...this.customers]; }
  async getCustomer(id: string): Promise<B2bCustomer | undefined> {
    return this.customers.find((c) => c.id === id);
  }
  async replaceCustomer(c: B2bCustomer): Promise<void> {
    this.customers = this.customers.map((x) => (x.id === c.id ? c : x));
  }
  async listQuotations(): Promise<Quotation[]> { return [...this.quotations]; }
  async getQuotation(id: string): Promise<Quotation | undefined> {
    return this.quotations.find((q) => q.id === id);
  }
  async addQuotation(q: Quotation): Promise<Quotation> { this.quotations.push(q); return q; }
  async replaceQuotation(q: Quotation): Promise<void> {
    this.quotations = this.quotations.map((x) => (x.id === q.id ? q : x));
  }
}

/* ------------------------------------------------------------------ */
/* Sync demo facade for the admin page playground (unchanged contract)  */
/* ------------------------------------------------------------------ */

class DemoB2bStore {
  private customers: B2bCustomer[] = [
    {
      id: "b2b_demo_1", businessName: "SAMPLE Wholesale Traders", contactName: "Demo Contact",
      phone: "+8801700000000", approvalStatus: "PENDING", creditLimitPoisha: 50000000,
      outstandingPoisha: 0, createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];
  private quotations: Quotation[] = [];

  listCustomers(): B2bCustomer[] { return [...this.customers]; }
  getCustomer(id: string): B2bCustomer | undefined { return this.customers.find((c) => c.id === id); }
  replaceCustomer(c: B2bCustomer): void {
    this.customers = this.customers.map((x) => (x.id === c.id ? c : x));
  }
  listQuotations(): Quotation[] { return [...this.quotations]; }
  addQuotation(q: Quotation): Quotation { this.quotations.push(q); return q; }
  replaceQuotation(q: Quotation): void {
    this.quotations = this.quotations.map((x) => (x.id === q.id ? q : x));
  }
}

/** Shared demo instance used by the admin B2B page only. */
export const demoB2bStore = new DemoB2bStore();
