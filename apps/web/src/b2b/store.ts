// In-memory DEMO store — Agent 16. TEMPORARY: replaced by Prisma-backed
// stores behind these same shapes once Prisma generate succeeds.
import type { B2bCustomer, Quotation } from "./types";

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

export const demoB2bStore = new DemoB2bStore();
