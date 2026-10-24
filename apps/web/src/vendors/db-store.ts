/**
 * Prisma-backed vendor store — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): API routes import this file
 * directly; src/vendors/store.ts stays Prisma-free for client safety.
 *
 * SCOPE: vendor records only. VendorProduct and CommissionLine have
 * NO tables in the merged schema (Product rows carry no vendor link),
 * so product approvals and commission lines remain in-memory in the
 * route store — see app/api/v1/admin/vendors/store.ts.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - The DB Vendor row has a single `name` column where the TS
 *    contract has shopName + ownerName: name <- shopName on write;
 *    ownerName echoes on the create return and reads back "".
 *  - status is a free String column: TS values (PENDING / ACTIVE /
 *    SUSPENDED / REJECTED) are stored verbatim.
 *  - Soft delete (deletedAt) is respected on every read.
 */
import { prisma } from "@advance-ecommerce/db";
import type { VendorStore } from "./store";
import type { Vendor, VendorStatus } from "./types";

type VendorRow = Awaited<ReturnType<typeof prisma.vendor.findMany>>[number];

const VENDOR_STATUSES: readonly VendorStatus[] = ["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"];

function rowToVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    shopName: row.name,
    ownerName: "",
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
        phone: v.phone,
        commissionBps: v.commissionBps,
        status: v.status,
      },
    });
    // Write echo: ownerName is not persisted (see header).
    return { ...rowToVendor(row), ownerName: v.ownerName };
  }

  async setVendorStatus(id: string, status: Vendor["status"]): Promise<void> {
    await prisma.vendor.update({ where: { id }, data: { status } });
  }

  /** Full replace used by staff tooling; routes prefer setVendorStatus. */
  async replaceVendor(v: Vendor): Promise<void> {
    await prisma.vendor.update({
      where: { id: v.id },
      data: { name: v.shopName, phone: v.phone, commissionBps: v.commissionBps, status: v.status },
    });
  }
}

/** Shared Prisma instance used by the vendor API route store. */
export const vendorStore: PrismaVendorStore = new PrismaVendorStore();
