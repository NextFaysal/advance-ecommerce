// Route-local DEMO store for the vendor admin API — Agent 18.
// src/vendors/store.ts (Agent 16) is read-only for products and has no
// vendor mutation helpers, and it is outside this slice's owned files.
// This store therefore WRAPS it: the base vendor list comes from
// demoVendorStore, while vendors created via the API, vendor status
// changes, product-approval decisions, and the demo commission/refund
// rows used by the payout summary live here as overrides. Everything is
// in-memory and labelled in-memory-demo in route meta; a Prisma-backed
// store replaces both layers behind the same route contracts.
import { demoVendorStore } from "@/vendors/store";
import type { CommissionLine, Vendor, VendorProduct } from "@/vendors/types";

class VendorApiDemoStore {
  private created: Vendor[] = [];
  private statusOverrides = new Map<string, Vendor["status"]>();
  private products: VendorProduct[] = [
    {
      id: "vprod_demo_1", vendorId: "vendor_demo_1", productName: "SAMPLE Vendor Product",
      sku: "SAMPLE-VP-1", pricePoisha: 45000, approval: "PENDING_REVIEW",
    },
  ];
  private approvalOverrides = new Map<string, VendorProduct>();
  /** Demo commission rows (SAMPLE) feeding GET /vendors/[id]/payout. */
  private commissionLines: CommissionLine[] = [];
  private refundsByVendor = new Map<string, number>();

  listVendors(): Vendor[] {
    const base = demoVendorStore.listVendors().map((v) => {
      const status = this.statusOverrides.get(v.id);
      return status ? { ...v, status } : v;
    });
    return [...base, ...this.created];
  }

  getVendor(id: string): Vendor | undefined {
    return this.listVendors().find((v) => v.id === id);
  }

  addVendor(v: Vendor): Vendor { this.created.push(v); return v; }

  setVendorStatus(id: string, status: Vendor["status"]): void {
    const created = this.created.find((v) => v.id === id);
    if (created) created.status = status;
    else this.statusOverrides.set(id, status);
  }

  listProducts(vendorId?: string): VendorProduct[] {
    const base = demoVendorStore.listProducts(vendorId);
    const merged = [...base, ...this.products.filter((p) => !vendorId || p.vendorId === vendorId)];
    return merged.map((p) => this.approvalOverrides.get(p.id) ?? p);
  }

  getProduct(id: string): VendorProduct | undefined {
    return this.listProducts().find((p) => p.id === id);
  }

  replaceProduct(p: VendorProduct): void { this.approvalOverrides.set(p.id, p); }

  listCommissionLines(vendorId: string): CommissionLine[] {
    return this.commissionLines.filter((l) => l.vendorId === vendorId);
  }

  addCommissionLine(line: CommissionLine): void { this.commissionLines.push(line); }

  refundsPoisha(vendorId: string): number { return this.refundsByVendor.get(vendorId) ?? 0; }
}

export const vendorApiStore = new VendorApiDemoStore();
