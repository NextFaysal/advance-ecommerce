/**
 * Prisma-backed advanced-orders store — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): API routes import this file
 * directly; src/advanced-orders/store.ts stays Prisma-free because a
 * client component imports the module index.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - The DB PreOrder row is keyed by customerId / productId / variantId;
 *    the TS contract carries customerPhone / productVariantId / sku. On
 *    write the store resolves phone -> Customer (creating a minimal
 *    Customer row for an unknown phone — the same row an order placed
 *    from that phone creates) and variant -> its productId when the
 *    variant exists in the catalog (otherwise the variant id is stored
 *    in productId too, so the row round-trips). On read, ids resolve
 *    back to phone / variantId; a missing customer reads phone "".
 *  - `sku` has NO column: it echoes on write (addPreOrder's return) and
 *    reads back "" from list/replace paths.
 *  - totalPoisha is the only money column: unitPricePoisha is derived
 *    on read as totalPoisha / quantity — exact for every row this store
 *    writes, since writes always set total = unitPrice * quantity.
 *  - fulfilledQty has NO column: reads back as quantity when the status
 *    is FULFILLED, else 0. Partial fulfilment QUANTITY is not persisted.
 *  - The DB status enum has DEPOSIT_PAID / READY where the TS contract
 *    has PARTIALLY_FULFILLED: PARTIALLY_FULFILLED -> READY on write;
 *    READY -> PARTIALLY_FULFILLED and DEPOSIT_PAID -> OPEN on read (a
 *    deposit-paid pre-order is still open in the TS contract; the
 *    deposit itself is visible in depositPoisha).
 *  - Soft delete (deletedAt) is respected: deleted rows never list.
 */
import { prisma } from "@advance-ecommerce/db";
import type { PreOrder, PreOrderStatus } from "./types";
import type { StockTransfer, TransferLine, TransferStatus } from "./inventory-advanced";
import type { AdvancedOrderStore } from "./store";

type PreOrderRow = Awaited<ReturnType<typeof prisma.preOrder.findMany>>[number];
type StockTransferRow = Awaited<ReturnType<typeof prisma.stockTransfer.findMany>>[number];

type DbPreOrderStatus = "OPEN" | "DEPOSIT_PAID" | "READY" | "FULFILLED" | "CANCELLED";

function statusToDb(status: PreOrderStatus): DbPreOrderStatus {
  switch (status) {
    case "PARTIALLY_FULFILLED": return "READY";
    default: return status;
  }
}

function statusFromDb(status: string): PreOrderStatus {
  switch (status) {
    case "READY": return "PARTIALLY_FULFILLED";
    case "DEPOSIT_PAID": return "OPEN";
    case "FULFILLED": return "FULFILLED";
    case "CANCELLED": return "CANCELLED";
    default: return "OPEN";
  }
}

const TRANSFER_STATUSES: readonly TransferStatus[] = ["DRAFT", "IN_TRANSIT", "RECEIVED", "CANCELLED"];

function rowToTransfer(row: StockTransferRow): StockTransfer {
  const lines = Array.isArray(row.itemsJson) ? (row.itemsJson as unknown as TransferLine[]) : [];
  return {
    id: row.id,
    fromWarehouseId: row.fromWarehouseId,
    toWarehouseId: row.toWarehouseId,
    lines,
    status: TRANSFER_STATUSES.includes(row.status as TransferStatus)
      ? (row.status as TransferStatus)
      : "DRAFT",
    createdAt: row.createdAt.toISOString(),
    dispatchedAt: row.shippedAt?.toISOString(),
    receivedAt: row.receivedAt?.toISOString(),
  };
}

export class PrismaAdvancedOrderStore implements AdvancedOrderStore {
  /** Resolve a phone to a Customer id, creating the minimal row if new. */
  private async resolveCustomerId(phone: string): Promise<string> {
    const existing = await prisma.customer.findFirst({
      where: { phone, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await prisma.customer.create({
      data: { name: "Pre-order customer", phone, tags: [] },
      select: { id: true },
    });
    return created.id;
  }

  private async resolveProductId(variantId: string): Promise<string> {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: { productId: true },
    });
    return variant?.productId ?? variantId;
  }

  private rowToPreOrder(row: PreOrderRow, phoneByCustomerId: Map<string, string>): PreOrder {
    const status = statusFromDb(row.status);
    return {
      id: row.id,
      productVariantId: row.variantId ?? row.productId,
      sku: "",
      customerPhone: phoneByCustomerId.get(row.customerId) ?? "",
      quantity: row.quantity,
      unitPricePoisha: row.quantity > 0 ? Math.floor(row.totalPoisha / row.quantity) : 0,
      depositPoisha: row.depositPoisha,
      expectedDate: row.expectedDate ? row.expectedDate.toISOString().slice(0, 10) : "",
      status,
      fulfilledQty: status === "FULFILLED" ? row.quantity : 0,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async phonesFor(rows: PreOrderRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.customerId))];
    if (ids.length === 0) return new Map();
    const customers = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, phone: true },
    });
    return new Map(customers.map((c) => [c.id, c.phone]));
  }

  async listPreOrders(): Promise<PreOrder[]> {
    const rows = await prisma.preOrder.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    const phones = await this.phonesFor(rows);
    return rows.map((r) => this.rowToPreOrder(r, phones));
  }

  async addPreOrder(pre: PreOrder): Promise<PreOrder> {
    const [customerId, productId] = await Promise.all([
      this.resolveCustomerId(pre.customerPhone),
      this.resolveProductId(pre.productVariantId),
    ]);
    const row = await prisma.preOrder.create({
      data: {
        ...(pre.id ? { id: pre.id } : {}),
        customerId,
        productId,
        variantId: pre.productVariantId,
        quantity: pre.quantity,
        depositPoisha: pre.depositPoisha,
        totalPoisha: pre.unitPricePoisha * pre.quantity,
        expectedDate: pre.expectedDate ? new Date(pre.expectedDate) : null,
        status: statusToDb(pre.status),
      },
    });
    // Write echo: non-persisted fields (sku) ride back on the returned
    // object; they are absent from later reads (see header drift notes).
    return { ...this.rowToPreOrder(row, new Map([[customerId, pre.customerPhone]])), sku: pre.sku };
  }

  async replacePreOrder(pre: PreOrder): Promise<void> {
    const [customerId, productId] = await Promise.all([
      this.resolveCustomerId(pre.customerPhone),
      this.resolveProductId(pre.productVariantId),
    ]);
    await prisma.preOrder.update({
      where: { id: pre.id },
      data: {
        customerId,
        productId,
        variantId: pre.productVariantId,
        quantity: pre.quantity,
        depositPoisha: pre.depositPoisha,
        totalPoisha: pre.unitPricePoisha * pre.quantity,
        expectedDate: pre.expectedDate ? new Date(pre.expectedDate) : null,
        status: statusToDb(pre.status),
      },
    });
  }

  async listTransfers(): Promise<StockTransfer[]> {
    const rows = await prisma.stockTransfer.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map(rowToTransfer);
  }

  async addTransfer(t: StockTransfer): Promise<StockTransfer> {
    const row = await prisma.stockTransfer.create({
      data: {
        ...(t.id ? { id: t.id } : {}),
        fromWarehouseId: t.fromWarehouseId,
        toWarehouseId: t.toWarehouseId,
        status: t.status,
        itemsJson: t.lines as unknown as object[],
        shippedAt: t.dispatchedAt ? new Date(t.dispatchedAt) : null,
        receivedAt: t.receivedAt ? new Date(t.receivedAt) : null,
      },
    });
    return rowToTransfer(row);
  }
}

/** Shared Prisma instance used by the advanced-orders API routes. */
export const advancedOrderStore: AdvancedOrderStore = new PrismaAdvancedOrderStore();
