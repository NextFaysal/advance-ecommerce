/**
 * Inventory repository — DB-backed persistence (Prisma).
 *
 * Replaces the in-memory InventoryStore behind the admin inventory
 * routes. The stock_movements ledger is the single source of truth:
 *
 * - applyMovementDb() runs planMovement() (src/inventory/service.ts —
 *   the SAME pure rules the in-memory store uses) inside one
 *   prisma.$transaction, with the InventoryItem row locked
 *   (SELECT ... FOR UPDATE) so concurrent movements cannot oversell:
 *   quantityAvailable = onHand - reserved can never go negative because
 *   reserve/transfer_out/damage are rejected by the ledger rules before
 *   any write, and the transaction rolls back on a throw.
 * - Both legs of a transfer are written in the SAME transaction.
 * - ProductVariant.stock (the denormalized cache the catalog adapter
 *   maintains and checkout reads) is re-synced in the same transaction
 *   to the variant's total quantityOnHand across warehouses — the
 *   catalog adapter's convention (its InventoryItem onHand tracks the
 *   cache at the default warehouse) extended consistently.
 * - Movement type mapping mirrors the catalog adapter's
 *   DB_STOCK_MOVEMENT_TYPE (service vocabulary -> schema enum):
 *   purchase_receive -> PURCHASE_RECEIVE, sale_reserve -> SALE_RESERVE,
 *   sale_commit -> SALE_COMMIT, sale_release -> SALE_RELEASE,
 *   sale_restore -> SALE_RESTORE, adjustment -> ADJUSTMENT,
 *   transfer_out -> TRANSFER_OUT, transfer_in -> TRANSFER_IN,
 *   damage -> DAMAGE, return_receive -> RETURN_RECEIVE.
 * - StockMovement.actorId is an FK to User: an actorId that is not a
 *   real user id persists as NULL rather than violating the FK (the
 *   audit log is where actor attribution is contractual).
 *
 * Purchase orders persist to the PurchaseOrder/PurchaseOrderItem tables
 * (Supplier is an FK: an unknown supplierId find-or-creates a Supplier
 * by the supplied name, and the DB id is what reads back).
 */
import { prisma } from "@advance-ecommerce/db";
import { notifyBackInStockForVariant } from "../storefront-ux/back-in-stock-notify";
import { emitAutomationEvent } from "../automation/producers";
import { dispatchWebhookEvent } from "../webhooks/dispatch";
import {
  planMovement,
  type MovementAction,
  type PurchaseOrder,
  type PurchaseOrderInput,
} from "./service";
import type { InventoryItem, StockMovement, StockMovementType } from "./types";

/** Default low-stock threshold (units) — same value the demo used. */
export const LOW_STOCK_THRESHOLD = 5;

/* ------------------------------------------------------------------ */
/* Enum mapping (TS domain <-> Prisma schema)                          */
/* ------------------------------------------------------------------ */

const MOVEMENT_TYPE_TO_DB: Record<StockMovementType, string> = {
  purchase_receive: "PURCHASE_RECEIVE",
  sale_reserve: "SALE_RESERVE",
  sale_commit: "SALE_COMMIT",
  sale_release: "SALE_RELEASE",
  sale_restore: "SALE_RESTORE",
  adjustment: "ADJUSTMENT",
  transfer_out: "TRANSFER_OUT",
  transfer_in: "TRANSFER_IN",
  return_receive: "RETURN_RECEIVE",
  damage: "DAMAGE",
};

const MOVEMENT_TYPE_FROM_DB: Record<string, StockMovementType> = Object.fromEntries(
  Object.entries(MOVEMENT_TYPE_TO_DB).map(([ts, db]) => [db, ts as StockMovementType]),
);

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

interface InventoryItemRow {
  variantId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
}

function rowToItem(row: InventoryItemRow): InventoryItem {
  return {
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    quantityOnHand: row.quantityOnHand,
    quantityReserved: row.quantityReserved,
    quantityAvailable: row.quantityOnHand - row.quantityReserved,
  };
}

interface StockMovementRow {
  id: string;
  variantId: string;
  warehouseId: string;
  type: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  referenceType: string;
  referenceId: string;
  reason: string;
  actorId: string | null;
  createdAt: Date;
}

function rowToMovement(row: StockMovementRow): StockMovement {
  return {
    id: row.id,
    variantId: row.variantId,
    warehouseId: row.warehouseId,
    type: MOVEMENT_TYPE_FROM_DB[row.type] ?? "adjustment",
    quantityDelta: row.quantityDelta,
    quantityBefore: row.quantityBefore,
    quantityAfter: row.quantityAfter,
    // The DB column is a free string; the TS union lists the values the
    // service layer writes (cast — same convention as orders/repository).
    referenceType: row.referenceType as StockMovement["referenceType"],
    referenceId: row.referenceId,
    reason: row.reason,
    actorId: row.actorId ?? "system",
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listInventoryItemsDb(): Promise<InventoryItem[]> {
  const rows = await prisma.inventoryItem.findMany({
    orderBy: [{ warehouseId: "asc" }, { variantId: "asc" }],
  });
  return rows.map(rowToItem);
}

export async function getInventoryItemDb(
  variantId: string,
  warehouseId: string,
): Promise<InventoryItem | null> {
  const row = await prisma.inventoryItem.findUnique({
    where: { variantId_warehouseId: { variantId, warehouseId } },
  });
  return row ? rowToItem(row) : null;
}

export async function listMovementsDb(variantId?: string): Promise<StockMovement[]> {
  const rows = await prisma.stockMovement.findMany({
    where: variantId ? { variantId } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map(rowToMovement);
}

export async function listWarehousesDb(): Promise<{ id: string; name: string; isActive: boolean }[]> {
  return prisma.warehouse.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, isActive: true },
  });
}

export interface VariantProductMeta {
  variantId: string;
  sku: string;
  productId: string;
  productTitleBn: string;
  productSlug: string;
  /** Per-product low-stock threshold override (Wave 14); null = fall
   *  back to the Settings default, then LOW_STOCK_THRESHOLD. */
  lowStockThreshold: number | null;
}

/** variantId -> owning product (+ the variant SKU and the product's
 *  low-stock threshold override). The inventory page uses this to list
 *  low stock BY PRODUCT NAME instead of bare variant ids (Wave 14-2);
 *  InventoryItem rows themselves carry no product link. */
export async function getVariantProductMetaDb(variantIds: string[]): Promise<Map<string, VariantProductMeta>> {
  const map = new Map<string, VariantProductMeta>();
  if (variantIds.length === 0) return map;
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: {
      id: true,
      sku: true,
      product: { select: { id: true, titleBn: true, slug: true, lowStockThreshold: true } },
    },
  });
  for (const r of rows) {
    map.set(r.id, {
      variantId: r.id,
      sku: r.sku,
      productId: r.product.id,
      productTitleBn: r.product.titleBn,
      productSlug: r.product.slug,
      lowStockThreshold: r.product.lowStockThreshold,
    });
  }
  return map;
}

/** variantId -> costPoisha for variants that carry a cost (nullable in
 *  the schema; variants without a cost are reported by the caller, the
 *  valuation never invents one). */
export async function getVariantCostMapDb(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, costPoisha: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) if (r.costPoisha !== null) map.set(r.id, r.costPoisha);
  return map;
}

/** variantId -> ProductVariant.stock — the CANONICAL per-variant
 *  availability (doc 18, F1). This cache is the number the order
 *  funnel actually claims against: reserveOrderLineItems runs its
 *  guarded decrement (WHERE stock >= qty) on ProductVariant.stock,
 *  and the storefront/checkout reads the same column. Admin surfaces
 *  must headline THIS number per variant.
 *
 *  Why not Σ InventoryItem.quantityAvailable: the order seam's
 *  InventoryItem upsert sets quantityOnHand to the POST-CLAIM cache
 *  value while ALSO incrementing quantityReserved, so the ledger
 *  rows subtract every reservation twice (once inside the cache,
 *  once as reserved) and the summed availability reads lower than
 *  what checkout will sell — the wave-19 divergence. The warehouse
 *  rows stay useful as a secondary breakdown (where stock physically
 *  sits, per the ledger), never as the headline. */
export async function getVariantStockCacheDb(variantIds: string[]): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: variantIds } },
    select: { id: true, stock: true },
  });
  return new Map(rows.map((r) => [r.id, r.stock]));
}

/* ------------------------------------------------------------------ */
/* Movements (the ledger write path)                                   */
/* ------------------------------------------------------------------ */

type Tx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Resolves a caller-supplied actor id to a real User id (or NULL) so
 * StockMovement.actorId never violates its FK. Exported for
 * src/inventory/purchase-receive.ts (ADV-11b), which runs the ledger
 * inside its own purchase-order transaction.
 */
export async function resolveActorId(tx: Tx, actorId: string): Promise<string | null> {
  if (!actorId) return null;
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * The in-transaction ledger writer behind applyMovementDb. Exported
 * for src/inventory/purchase-receive.ts (ADV-11b) so a PO receive can
 * update the PO rows AND book its PURCHASE_RECEIVE movements through
 * this exact seam (row lock + planMovement rules + ProductVariant
 * cache re-sync) inside ONE transaction. Callers using it directly
 * own the post-commit side effects applyMovementDb performs
 * (back-in-stock notify, stock.low automation).
 */
export async function applyMovementInTx(
  tx: Tx,
  input: MovementAction,
  actorId: string | null,
): Promise<{ item: InventoryItem; movement: StockMovement }> {
  // Ensure the row exists, then lock it for the read-modify-write.
  await tx.inventoryItem.upsert({
    where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId } },
    create: { variantId: input.variantId, warehouseId: input.warehouseId, quantityOnHand: 0, quantityReserved: 0 },
    update: {},
  });
  const locked = await tx.$queryRaw<InventoryItemRow[]>`
    SELECT "variantId", "warehouseId", "quantityOnHand", "quantityReserved"
    FROM "InventoryItem"
    WHERE "variantId" = ${input.variantId} AND "warehouseId" = ${input.warehouseId}
    FOR UPDATE`;
  const row = locked[0];
  if (!row) throw new Error("inventory item vanished inside transaction");
  const before = rowToItem(row);
  // Throws on insufficient available / over-commit / over-release —
  // the transaction rolls back, so a rejected movement writes nothing.
  const planned = planMovement(before, input);
  await tx.inventoryItem.update({
    where: { variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId } },
    data: {
      quantityOnHand: planned.after.quantityOnHand,
      quantityReserved: planned.after.quantityReserved,
    },
  });
  const movementRow = await tx.stockMovement.create({
    data: {
      variantId: input.variantId,
      warehouseId: input.warehouseId,
      type: MOVEMENT_TYPE_TO_DB[planned.type] as never,
      quantityDelta: planned.quantityDelta,
      quantityBefore: before.quantityOnHand,
      quantityAfter: planned.after.quantityOnHand,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      actorId,
    },
  });
  // Keep the denormalized ProductVariant.stock cache equal to the
  // variant's total onHand across warehouses (catalog convention).
  const agg = await tx.inventoryItem.aggregate({
    where: { variantId: input.variantId },
    _sum: { quantityOnHand: true },
  });
  await tx.productVariant.update({
    where: { id: input.variantId },
    data: { stock: agg._sum.quantityOnHand ?? 0 },
  });
  const result = { item: planned.after, movement: rowToMovement(movementRow) };
  if (input.action === "transfer_out" && input.toWarehouseId) {
    // Mirror leg in the SAME transaction — both legs land or neither.
    await applyMovementInTx(
      tx,
      { ...input, action: "transfer_in", warehouseId: input.toWarehouseId, toWarehouseId: undefined, referenceType: "transfer" },
      actorId,
    );
  }
  return result;
}

/**
 * Applies one stock movement through the ledger, in a transaction.
 * The returned movement is the primary leg (for a transfer_out with a
 * destination, the transfer_in leg is persisted too but not returned —
 * same shape as the in-memory applyMovement contract).
 *
 * Doc 21 G3-9 hook: when the movement takes the variant's canonical
 * availability (ProductVariant.stock) across 0 -> positive, pending
 * back-in-stock signups may finally be notified. The check reads the
 * cache before and after THIS transaction commits (so transfers,
 * whose mirror leg lands in the same tx, correctly net to no
 * crossing), and the notify itself is fire-and-forget — the producer
 * never throws and an enqueue failure must never fail a stock write
 * that already committed.
 */
export async function applyMovementDb(
  input: MovementAction,
): Promise<{ item: InventoryItem; movement: StockMovement }> {
  const cacheBefore = await prisma.productVariant
    .findUnique({ where: { id: input.variantId }, select: { stock: true } })
    .then((row) => row?.stock ?? 0)
    .catch(() => 0);
  const result = await prisma.$transaction(async (tx) => {
    const actorId = await resolveActorId(tx, input.actorId);
    return applyMovementInTx(tx, input, actorId);
  });
  const cacheAfter = await prisma.productVariant
    .findUnique({ where: { id: input.variantId }, select: { stock: true } })
    .then((row) => row?.stock ?? 0)
    .catch(() => 0);
  if (cacheBefore <= 0 && cacheAfter > 0) {
    void notifyBackInStockForVariant(input.variantId).catch(() => undefined);
  }
  // Automation lifecycle (ADV-7): stock.low fires when THIS movement
  // DECREASED canonical availability to at/below the variant's
  // low-stock threshold (product override, else LOW_STOCK_THRESHOLD —
  // the same resolution the low-stock read model documents). Restocks
  // and no-op movements never fire it; the engine's stockAvailable
  // condition is the final arbiter of what counts as "low". Coverage
  // note: order-driven depletion flows through applyMovementInTx
  // inside createOrderRecord's transaction, not through here — this
  // hook covers staff / PO / adjustment movements. The producer is
  // flag-gated and never throws.
  if (cacheAfter < cacheBefore) {
    const meta = await getVariantProductMetaDb([input.variantId])
      .then((map) => map.get(input.variantId))
      .catch(() => undefined);
    const threshold = meta?.lowStockThreshold ?? LOW_STOCK_THRESHOLD;
    if (cacheAfter <= threshold) {
      await emitAutomationEvent("stock.low", input.variantId);
      // Webhooks (ADV-26): same emit seam. Never throws.
      await dispatchWebhookEvent("stock.low", input.variantId);
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Purchase orders                                                     */
/* ------------------------------------------------------------------ */

const PO_STATUS_FROM_DB: Record<string, PurchaseOrder["status"]> = {
  DRAFT: "draft",
  ORDERED: "ordered",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED: "received",
  CANCELLED: "cancelled",
};

type PurchaseOrderRow = Awaited<ReturnType<typeof findPurchaseOrderRows>>[number];

async function findPurchaseOrderRows() {
  return prisma.purchaseOrder.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      supplier: { select: { name: true } },
      items: true,
    },
  });
}

function poRowToPurchaseOrder(row: PurchaseOrderRow): PurchaseOrder {
  return {
    id: row.id,
    supplierId: row.supplierId,
    supplierName: row.supplier.name,
    warehouseId: row.warehouseId ?? "",
    items: row.items.map((i) => ({
      variantId: i.variantId,
      quantity: i.quantityOrdered,
      costPoisha: i.costPoisha,
    })),
    ...(row.note ? { note: row.note } : {}),
    status: PO_STATUS_FROM_DB[row.status] ?? "draft",
    totalPoisha: row.totalPoisha,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPurchaseOrdersDb(): Promise<PurchaseOrder[]> {
  const rows = await findPurchaseOrderRows();
  return rows.map(poRowToPurchaseOrder);
}

/**
 * Creates a purchase order in DRAFT. Supplier is an FK: an existing
 * supplierId is used as-is; an unknown one find-or-creates a Supplier
 * from the supplied name (the response carries the DB supplier id —
 * the input's free-string id is a demo-era contract, see header).
 * Warehouse and every variant must exist (FK integrity, checked with
 * explicit errors instead of a raw constraint failure).
 */
export async function createPurchaseOrderDb(input: PurchaseOrderInput): Promise<PurchaseOrder> {
  const totalPoisha = input.items.reduce((s, i) => s + i.quantity * i.costPoisha, 0);
  const created = await prisma.$transaction(async (tx) => {
    const warehouse = await tx.warehouse.findFirst({
      where: { id: input.warehouseId, deletedAt: null },
      select: { id: true },
    });
    if (!warehouse) throw new Error(`warehouse_not_found: ${input.warehouseId}`);
    const variantIds = [...new Set(input.items.map((i) => i.variantId))];
    const variants = await tx.productVariant.findMany({
      where: { id: { in: variantIds }, deletedAt: null },
      select: { id: true },
    });
    if (variants.length !== variantIds.length) {
      const found = new Set(variants.map((v) => v.id));
      const missing = variantIds.filter((id) => !found.has(id));
      throw new Error(`variant_not_found: ${missing.join(", ")}`);
    }
    let supplier = await tx.supplier.findFirst({
      where: { id: input.supplierId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) {
      supplier = await tx.supplier.create({
        data: { name: input.supplierName },
        select: { id: true },
      });
    }
    const po = await tx.purchaseOrder.create({
      data: {
        supplierId: supplier.id,
        warehouseId: input.warehouseId,
        status: "DRAFT",
        totalPoisha,
        note: input.note ?? null,
        items: {
          create: input.items.map((i) => ({
            variantId: i.variantId,
            quantityOrdered: i.quantity,
            quantityReceived: 0,
            costPoisha: i.costPoisha,
          })),
        },
      },
      include: { supplier: { select: { name: true } }, items: true },
    });
    return po;
  });
  return poRowToPurchaseOrder(created as PurchaseOrderRow);
}
