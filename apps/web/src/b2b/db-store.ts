/**
 * Prisma-backed B2B store — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): API routes import this file
 * directly; src/b2b/store.ts stays Prisma-free for client-bundle safety.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - Field renames only for customers: businessName <-> companyName,
 *    outstandingPoisha <-> duePoisha, approvalStatus <-> status (a free
 *    String column: TS values are stored verbatim; the schema default
 *    "PENDING_APPROVAL" reads back as "PENDING"). Quotation lines ride
 *    in itemsJson verbatim; validUntil is a DateTime read back as a
 *    date-only string, matching the TS contract's ISO-date shape.
 *  - tradeLicenseNo and oldestDueDate are real columns since migration
 *    20261025112500_b2b_credit_dates_and_order_vat (wave 7): they persist
 *    on write and read back — oldestDueDate as a date-only ISO string,
 *    the same shape as Quotation.validUntil — so checkCredit's
 *    overdue-by-date rule now fires for persisted customers.
 *  - Soft delete (deletedAt) is respected on every read.
 *  - Wholesale price tiers (WholesalePriceList) remain pure pricing
 *    inputs — no tier table exists and no route persists them.
 */
import { prisma } from "@advance-ecommerce/db";
import type { B2bApprovalStatus, B2bCustomer, Quotation, QuotationLine, QuotationStatus } from "./types";
import type { B2bStore } from "./store";

type B2bCustomerRow = Awaited<ReturnType<typeof prisma.b2bCustomer.findMany>>[number];
type QuotationRow = Awaited<ReturnType<typeof prisma.quotation.findMany>>[number];

const APPROVAL_STATUSES: readonly B2bApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"];
const QUOTATION_STATUSES: readonly QuotationStatus[] = ["DRAFT", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CONVERTED"];

function approvalFromDb(status: string): B2bApprovalStatus {
  if (status === "PENDING_APPROVAL") return "PENDING";
  return APPROVAL_STATUSES.includes(status as B2bApprovalStatus)
    ? (status as B2bApprovalStatus)
    : "PENDING";
}

function rowToCustomer(row: B2bCustomerRow): B2bCustomer {
  return {
    id: row.id,
    businessName: row.companyName,
    contactName: row.contactName,
    phone: row.phone,
    tradeLicenseNo: row.tradeLicenseNo ?? undefined,
    approvalStatus: approvalFromDb(row.status),
    creditLimitPoisha: row.creditLimitPoisha,
    outstandingPoisha: row.duePoisha,
    oldestDueDate: row.oldestDueDate ? row.oldestDueDate.toISOString().slice(0, 10) : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToQuotation(row: QuotationRow): Quotation {
  const lines = Array.isArray(row.itemsJson) ? (row.itemsJson as unknown as QuotationLine[]) : [];
  return {
    id: row.id,
    b2bCustomerId: row.b2bCustomerId,
    lines,
    totalPoisha: row.totalPoisha,
    status: QUOTATION_STATUSES.includes(row.status as QuotationStatus)
      ? (row.status as QuotationStatus)
      : "DRAFT",
    validUntil: row.validUntil ? row.validUntil.toISOString().slice(0, 10) : "",
    convertedOrderId: row.convertedOrderId ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaB2bStore implements B2bStore {
  async listCustomers(): Promise<B2bCustomer[]> {
    const rows = await prisma.b2bCustomer.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToCustomer);
  }

  async getCustomer(id: string): Promise<B2bCustomer | undefined> {
    const row = await prisma.b2bCustomer.findFirst({ where: { id, deletedAt: null } });
    return row ? rowToCustomer(row) : undefined;
  }

  async replaceCustomer(c: B2bCustomer): Promise<void> {
    await prisma.b2bCustomer.update({
      where: { id: c.id },
      data: {
        companyName: c.businessName,
        contactName: c.contactName,
        phone: c.phone,
        tradeLicenseNo: c.tradeLicenseNo ?? null,
        creditLimitPoisha: c.creditLimitPoisha,
        duePoisha: c.outstandingPoisha,
        oldestDueDate: c.oldestDueDate ? new Date(c.oldestDueDate) : null,
        status: c.approvalStatus,
      },
    });
  }

  /** Create path used by staff tooling/tests — no admin route creates
   *  B2B customers yet (they arrive via application review upstream). */
  async addCustomer(c: B2bCustomer): Promise<B2bCustomer> {
    const row = await prisma.b2bCustomer.create({
      data: {
        ...(c.id && !c.id.startsWith("b2b_demo") ? { id: c.id } : {}),
        companyName: c.businessName,
        contactName: c.contactName,
        phone: c.phone,
        tradeLicenseNo: c.tradeLicenseNo ?? null,
        creditLimitPoisha: c.creditLimitPoisha,
        duePoisha: c.outstandingPoisha,
        oldestDueDate: c.oldestDueDate ? new Date(c.oldestDueDate) : null,
        status: c.approvalStatus,
      },
    });
    return rowToCustomer(row);
  }

  async listQuotations(): Promise<Quotation[]> {
    const rows = await prisma.quotation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToQuotation);
  }

  async getQuotation(id: string): Promise<Quotation | undefined> {
    const row = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
    return row ? rowToQuotation(row) : undefined;
  }

  async addQuotation(q: Quotation): Promise<Quotation> {
    const row = await prisma.quotation.create({
      data: {
        ...(q.id ? { id: q.id } : {}),
        b2bCustomerId: q.b2bCustomerId,
        itemsJson: q.lines as unknown as object[],
        totalPoisha: q.totalPoisha,
        status: q.status,
        validUntil: q.validUntil ? new Date(q.validUntil) : null,
        convertedOrderId: q.convertedOrderId ?? null,
      },
    });
    return rowToQuotation(row);
  }

  async replaceQuotation(q: Quotation): Promise<void> {
    await prisma.quotation.update({
      where: { id: q.id },
      data: {
        itemsJson: q.lines as unknown as object[],
        totalPoisha: q.totalPoisha,
        status: q.status,
        validUntil: q.validUntil ? new Date(q.validUntil) : null,
        convertedOrderId: q.convertedOrderId ?? null,
      },
    });
  }
}

/** Shared Prisma instance used by the B2B API routes. */
export const b2bStore: PrismaB2bStore = new PrismaB2bStore();
