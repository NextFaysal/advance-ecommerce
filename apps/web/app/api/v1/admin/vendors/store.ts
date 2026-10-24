// Route store for the vendor admin API — FULLY DB-backed.
// Vendor records, vendor products, commission lines and vendor
// refunds all persist through PrismaVendorStore (src/vendors/db-store.ts)
// over the Vendor / VendorProduct / VendorCommissionLine / VendorRefund
// tables. The last three tables arrived with the
// `advanced_modules_completion` migration (2026-10-25); before that,
// products / commissions / refunds lived in a process-local layer and
// the routes honestly labelled meta persistence: "mixed".
import { vendorStore } from "@/vendors/db-store";
import type { CommissionLine, Vendor, VendorProduct, VendorRefund } from "@/vendors/types";

class VendorApiStore {
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
    return vendorStore.listProducts(vendorId);
  }

  async getProduct(id: string): Promise<VendorProduct | undefined> {
    return vendorStore.getProduct(id);
  }

  async addProduct(p: VendorProduct): Promise<VendorProduct> {
    return vendorStore.addProduct(p);
  }

  async replaceProduct(p: VendorProduct): Promise<void> {
    await vendorStore.replaceProduct(p);
  }

  async listCommissionLines(vendorId: string): Promise<CommissionLine[]> {
    return vendorStore.listCommissionLines(vendorId);
  }

  async addCommissionLine(line: CommissionLine): Promise<CommissionLine> {
    return vendorStore.addCommissionLine(line);
  }

  async listRefunds(vendorId: string): Promise<VendorRefund[]> {
    return vendorStore.listRefunds(vendorId);
  }

  async addRefund(input: {
    vendorId: string;
    orderId?: string | null;
    amountPoisha: number;
    reason: string;
  }): Promise<VendorRefund> {
    return vendorStore.addRefund(input);
  }

  async refundsPoisha(vendorId: string): Promise<number> {
    return vendorStore.refundsPoisha(vendorId);
  }
}

export const vendorApiStore = new VendorApiStore();
