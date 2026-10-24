// Route store for the vendor admin API — PARTIALLY DB-backed since
// 2026-10-24. Vendor records (list / get / create / status) are served
// by PrismaVendorStore over the Vendor table (src/vendors/db-store.ts).
//
// What remains in-memory here, and why: the merged schema has NO
// vendor-product table and NO vendor-commission table (core Product
// rows carry no vendor link, and no commission-line model exists), so
// product approvals, commission lines and refund totals have nowhere
// to persist. They stay in this process-local layer, empty at boot —
// the previous SAMPLE product row belonged to the demo vendor, which
// no longer exists on the API surface now that vendors are real rows.
// Routes label this honestly in meta (persistence: "mixed").
import { vendorStore } from "@/vendors/db-store";
import type { CommissionLine, Vendor, VendorProduct } from "@/vendors/types";

class VendorApiStore {
  private products: VendorProduct[] = [];
  /** Commission rows feeding GET /vendors/[id]/payout (no DB table). */
  private commissionLines: CommissionLine[] = [];
  private refundsByVendor = new Map<string, number>();

  async listVendors(): Promise<Vendor[]> {
    return vendorStore.listVendors();
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    return vendorStore.getVendor(id);
  }

  async addVendor(v: Vendor): Promise<Vendor> {
    return vendorStore.addVendor(v);
  }

  async setVendorStatus(id: string, status: Vendor["status"]): Promise<void> {
    await vendorStore.setVendorStatus(id, status);
  }

  async listProducts(vendorId?: string): Promise<VendorProduct[]> {
    return vendorId ? this.products.filter((p) => p.vendorId === vendorId) : [...this.products];
  }

  async getProduct(id: string): Promise<VendorProduct | undefined> {
    return this.products.find((p) => p.id === id);
  }

  async replaceProduct(p: VendorProduct): Promise<void> {
    const idx = this.products.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.products[idx] = p;
    else this.products.push(p);
  }

  async listCommissionLines(vendorId: string): Promise<CommissionLine[]> {
    return this.commissionLines.filter((l) => l.vendorId === vendorId);
  }

  async addCommissionLine(line: CommissionLine): Promise<void> { this.commissionLines.push(line); }

  async refundsPoisha(vendorId: string): Promise<number> { return this.refundsByVendor.get(vendorId) ?? 0; }
}

export const vendorApiStore = new VendorApiStore();
