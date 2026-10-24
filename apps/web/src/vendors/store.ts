// Vendor store — Agent 16. Vendor RECORDS are DB-backed since
// 2026-10-24 (PrismaVendorStore in ./db-store.ts, used by the vendor API
// routes), and VendorProduct / commission lines / refunds are DB-backed
// since the `advanced_modules_completion` migration (2026-10-25) added
// their tables — db-store.ts covers all of them. THIS demo class is now
// only the admin page playground's sync fixture source (SAMPLE rows);
// no API route reads it.
import type { Vendor, VendorProduct } from "./types";

export interface VendorStore {
  listVendors(): Promise<Vendor[]>;
  getVendor(id: string): Promise<Vendor | undefined>;
  addVendor(v: Vendor): Promise<Vendor>;
  setVendorStatus(id: string, status: Vendor["status"]): Promise<void>;
}

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
