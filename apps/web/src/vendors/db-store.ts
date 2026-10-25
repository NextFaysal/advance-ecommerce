/**
 * Prisma-backed vendor store — vendor records DB-backed since
 * 2026-10-24; products / commission lines / refunds DB-backed since
 * the `advanced_modules_completion` migration (2026-10-25) added the
 * VendorProduct, VendorCommissionLine and VendorRefund tables.
 *
 * Server-only (imports the Prisma client): API routes import this file
 * directly; src/vendors/store.ts stays Prisma-free for client safety.
 *
 * SCHEMA NOTES:
 *  - The DB Vendor row's `name` column is the TS contract's shopName;
 *    ownerName persists on its own `ownerName` column (added by the
 *    reviews_and_small_fixes migration, 2026-10-25). Rows created
 *    before that migration read back ownerName "" (null in the DB).
 *  - status / approval are free String columns: TS values are stored
 *    verbatim (PENDING / ACTIVE / ... and PENDING_REVIEW / APPROVED /
 *    REJECTED / CHANGES_REQUESTED).
 *  - Soft delete (deletedAt) is respected on every read.
 *  - VendorCommissionLine has @@unique([orderId, vendorId]): one line
 *    per order per vendor. addCommissionLine is therefore idempotent
 *    per (order, vendor) — a replay returns the stored line instead
 *    of double-counting the payout.
 */
import { prisma } from "@advance-ecommerce/db";
import type { VendorStore } from "./store";
import type {
  CommissionLine, Vendor, VendorProduct, VendorProductApproval, VendorRefund, VendorStatus,
} from "./types";

type VendorRow = Awaited<ReturnType<typeof prisma.vendor.findMany>>[number];

const VENDOR_STATUSES: readonly VendorStatus[] = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"];

function rowToVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    shopName: row.name,
    ownerName: row.ownerName ?? "",
    phone: row.phone,
    status: VENDOR_STATUSES.includes(row.status as VendorStatus)
      ? (row.status as VendorStatus)
      : "PENDING",
    commissionBps: row.commissionBps,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaVendorStore implements VendorStore {
  async listVendors(): Promise<Vendor[]> {
    const rows = await prisma.vendor.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToVendor);
  }

  async getVendor(id: string): Promise<Vendor | undefined> {
    const row = await prisma.vendor.findFirst({ where: { id, deletedAt: null } });
    return row ? rowToVendor(row) : undefined;
  }

  async addVendor(v: Vendor): Promise<Vendor> {
    const row = await prisma.vendor.create({
      data: {
        ...(v.id ? { id: v.id } : {}),
        name: v.shopName,
        ownerName: v.ownerName ? v.ownerName : null,
        phone: v.phone,
        commissionBps: v.commissionBps,
        status: v.status,
      },
    });
    return rowToVendor(row);
  }

  async setVendorStatus(id: string, status: Vendor["status"]): Promise<void> {
    await prisma.vendor.update({ where: { id }, data: { status } });
  }

  /** Full replace used by staff tooling; routes prefer setVendorStatus. */
  async replaceVendor(v: Vendor): Promise<void> {
    await prisma.vendor.update({
      where: { id: v.id },
      data: {
        name: v.shopName,
        ownerName: v.ownerName ? v.ownerName : null,
        phone: v.phone,
        commissionBps: v.commissionBps,
        status: v.status,
      },
    });
  }

  /* ---------------- Vendor products (VendorProduct table) -------- */

  async listProducts(vendorId?: string): Promise<VendorProduct[]> {
    const rows = await prisma.vendorProduct.findMany({
      where: { deletedAt: null, ...(vendorId ? { vendorId } : {}) },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToVendorProduct);
  }

  async getProduct(id: string): Promise<VendorProduct | undefined> {
    const row = await prisma.vendorProduct.findFirst({ where: { id, deletedAt: null } });
    return row ? rowToVendorProduct(row) : undefined;
  }

  async addProduct(p: VendorProduct): Promise<VendorProduct> {
    const row = await prisma.vendorProduct.create({
      data: {
        ...(p.id ? { id: p.id } : {}),
        vendorId: p.vendorId,
        productId: p.productId ?? null,
        variantId: p.variantId ?? null,
        productName: p.productName,
        sku: p.sku,
        pricePoisha: p.pricePoisha,
        approval: p.approval,
        rejectionReason: p.rejectionReason ?? null,
      },
    });
    return rowToVendorProduct(row);
  }

  /** Upsert by id (the approval-decision write path in the routes). */
  async replaceProduct(p: VendorProduct): Promise<void> {
    const data = {
      vendorId: p.vendorId,
      productId: p.productId ?? null,
      variantId: p.variantId ?? null,
      productName: p.productName,
      sku: p.sku,
      pricePoisha: p.pricePoisha,
      approval: p.approval,
      rejectionReason: p.rejectionReason ?? null,
    };
    await prisma.vendorProduct.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }

  /* ---------------- Commission lines (VendorCommissionLine) ------- */

  async listCommissionLines(vendorId: string): Promise<CommissionLine[]> {
    const rows = await prisma.vendorCommissionLine.findMany({
      where: { vendorId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToCommissionLine);
  }

  /**
   * Append a commission line. Idempotent per (orderId, vendorId) via
   * the table's unique constraint: when a line already exists for the
   * pair, it is returned unchanged and nothing is written (the
   * delivered-order hook relies on this for exactly-once crediting).
   */
  async addCommissionLine(line: CommissionLine): Promise<CommissionLine> {
    const existing = await prisma.vendorCommissionLine.findUnique({
      where: { orderId_vendorId: { orderId: line.orderId, vendorId: line.vendorId } },
    });
    if (existing) return rowToCommissionLine(existing);
    const row = await prisma.vendorCommissionLine.create({
      data: {
        orderId: line.orderId,
        vendorId: line.vendorId,
        grossPoisha: line.grossPoisha,
        commissionBps: line.commissionBps,
        commissionPoisha: line.commissionPoisha,
        vendorEarningPoisha: line.vendorEarningPoisha,
      },
    });
    return rowToCommissionLine(row);
  }

  /* ---------------- Vendor refunds (VendorRefund table) ----------- */

  async listRefunds(vendorId: string): Promise<VendorRefund[]> {
    const rows = await prisma.vendorRefund.findMany({
      where: { vendorId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToVendorRefund);
  }

  async addRefund(input: {
    vendorId: string;
    orderId?: string | null;
    amountPoisha: number;
    reason: string;
  }): Promise<VendorRefund> {
    const row = await prisma.vendorRefund.create({
      data: {
        vendorId: input.vendorId,
        orderId: input.orderId ?? null,
        amountPoisha: input.amountPoisha,
        reason: input.reason,
      },
    });
    return rowToVendorRefund(row);
  }

  /** Total refunds charged back to the vendor, poisha (payout input). */
  async refundsPoisha(vendorId: string): Promise<number> {
    const agg = await prisma.vendorRefund.aggregate({
      where: { vendorId },
      _sum: { amountPoisha: true },
    });
    return agg._sum.amountPoisha ?? 0;
  }
}

type VendorProductRow = Awaited<ReturnType<typeof prisma.vendorProduct.findMany>>[number];
type CommissionLineRow = Awaited<ReturnType<typeof prisma.vendorCommissionLine.findMany>>[number];
type VendorRefundRow = Awaited<ReturnType<typeof prisma.vendorRefund.findMany>>[number];

const VENDOR_PRODUCT_APPROVALS: readonly VendorProductApproval[] = [
  "PENDING_REVIEW", "APPROVED", "REJECTED", "CHANGES_REQUESTED",
];

function rowToVendorProduct(row: VendorProductRow): VendorProduct {
  return {
    id: row.id,
    vendorId: row.vendorId,
    productName: row.productName,
    sku: row.sku,
    pricePoisha: row.pricePoisha,
    approval: VENDOR_PRODUCT_APPROVALS.includes(row.approval as VendorProductApproval)
      ? (row.approval as VendorProductApproval)
      : "PENDING_REVIEW",
    ...(row.rejectionReason ? { rejectionReason: row.rejectionReason } : {}),
    ...(row.productId ? { productId: row.productId } : {}),
    ...(row.variantId ? { variantId: row.variantId } : {}),
  };
}

function rowToCommissionLine(row: CommissionLineRow): CommissionLine {
  return {
    orderId: row.orderId,
    vendorId: row.vendorId,
    grossPoisha: row.grossPoisha,
    commissionBps: row.commissionBps,
    commissionPoisha: row.commissionPoisha,
    vendorEarningPoisha: row.vendorEarningPoisha,
  };
}

function rowToVendorRefund(row: VendorRefundRow): VendorRefund {
  return {
    id: row.id,
    vendorId: row.vendorId,
    orderId: row.orderId,
    amountPoisha: row.amountPoisha,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Shared Prisma instance used by the vendor API route store. */
export const vendorStore: PrismaVendorStore = new PrismaVendorStore();
