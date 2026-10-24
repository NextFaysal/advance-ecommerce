// In-memory DEMO store — Agent 16. TEMPORARY: replaced by Prisma-backed
// stores behind these same shapes once Prisma generate succeeds.
import type { Vendor, VendorProduct } from "./types";

class DemoVendorStore {
  private vendors: Vendor[] = [
    {
      id: "vendor_demo_1", shopName: "SAMPLE Vendor Shop", ownerName: "Demo Owner",
      phone: "+8801700000000", status: "PENDING", commissionBps: 1000,
      createdAt: "2026-10-24T00:00:00.000Z",
    },
  ];
  private products: VendorProduct[] = [];

  listVendors(): Vendor[] { return [...this.vendors]; }
  getVendor(id: string): Vendor | undefined { return this.vendors.find((v) => v.id === id); }
  listProducts(vendorId?: string): VendorProduct[] {
    return vendorId ? this.products.filter((p) => p.vendorId === vendorId) : [...this.products];
  }
  addProduct(p: VendorProduct): VendorProduct { this.products.push(p); return p; }
}

export const demoVendorStore = new DemoVendorStore();
