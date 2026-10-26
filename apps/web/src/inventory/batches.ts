/**
 * Inventory depth — batch/lot + serial/IMEI lifecycle (ADV-20, doc 22).
 *
 * Everything here is gated by the module.inventory_depth flag. With
 * the flag OFF, a PO receive carrying batch/serial fields is REJECTED
 * (never silently dropped — recorded units must not vanish), the
 * delivered hook writes nothing, and return receives flip nothing:
 * every pre-ADV-20 behaviour is byte-identical.
 *
 * WHAT IS TRACKED, HONESTLY:
 *  - InventoryBatch is a SUB-LEDGER of receipts: a batch row exists
 *    only when a PO receive named that batch code. Variants received
 *    without a batch code are untracked here — absence means
 *    "untracked", never zero, and ProductVariant.stock /
 *    InventoryItem remain the canonical stock figures.
 *  - SerialUnit rows exist only for serials captured at receive.
 *    A variant with 6 recorded serials and stock 10 has 4 untracked
 *    units; delivery marks only recorded units SOLD.
 *
 * DELIVERY (applyDeliveryDepth) runs from the delivered-order hooks
 * (src/orders/delivered-hooks.ts) — the platform's exactly-once-per-
 * transition seam, same discipline as the loyalty/reseller/vendor
 * credits. Serial allocation is additionally read-before-write
 * idempotent (units already SOLD for this order count toward the
 * line). Batch depletion is FEFO: earliest expiryDate first (nulls
 * last), then oldest received (createdAt) — with equal/absent expiry
 * dates that is exactly FIFO, and it satisfies doc 22's acceptance
 * ("an expiring batch is allocated first"). Known limitation, stated
 * plainly: batch depletion is not per-order idempotent — a delivery
 * replay after a full return + re-delivery can deplete twice,
 * because batch rows deliberately carry no order link (returns
 * restock the variant cache + serial statuses only; returned units
 * re-enter the UNTRACKED pool, since stamping them back into a lot
 * would fabricate lot/expiry provenance).
 *
 * RETURN RECEIVE (restoreSerialsForReturnDepth) mirrors the RMA
 * rules: RESTOCKABLE units flip SOLD → IN_STOCK (orderId cleared);
 * DAMAGED units flip SOLD → RETURNED (kept out of sellable stock,
 * orderId kept for traceability). Which physical units came back is
 * unknowable without scanning, so the earliest-sold units flip first
 * — deterministic, and stated here rather than hidden.
 */
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "../lib/feature-flags";

export const INVENTORY_DEPTH_FLAG = "module.inventory_depth";

export function isInventoryDepthEnabled(): boolean {
  try {
    return isFeatureEnabled(INVENTORY_DEPTH_FLAG);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Errors (receive path — surfaced through PurchaseReceiveError codes  */
/* in purchase-receive.ts; this module throws plain Errors with a      */
/* `depthCode` the receive funnel maps).                               */
/* ------------------------------------------------------------------ */

export type DepthErrorCode =
  | "serial_count_mismatch"
  | "duplicate_serial";

export class DepthError extends Error {
  readonly depthCode: DepthErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: DepthErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "DepthError";
    this.depthCode = code;
    this.details = details;
  }
}

type Tx = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/* ------------------------------------------------------------------ */
/* Receive capture (called INSIDE the PO receive transaction, after    */
/* the ledger movement for the line has booked).                       */
/* ------------------------------------------------------------------ */

export interface ReceiveDepthInput {
  variantId: string;
  warehouseId: string;
  quantity: number;
  costPoisha: number;
  purchaseOrderId: string;
  batchCode?: string;
  expiryDate?: Date | null;
  bin?: string;
  serials?: string[];
}

/**
 * Records the batch/serial side of ONE received line. Batch rows are
 * keyed by (variantId, warehouseId, batchCode): a repeat receive of
 * the same lot increments it, keeping the FIRST recorded expiry/cost
 * (a conflicting later value is not silently overwritten — staff
 * correct lots explicitly, never by accident of a second receipt).
 * Throws DepthError — the caller's transaction rolls the WHOLE
 * receive back, so a bad serial list can never half-book.
 */
export async function recordReceiveDepthInTx(
  tx: Tx,
  input: ReceiveDepthInput,
): Promise<{ batchId: string | null }> {
  const serials = (input.serials ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (input.serials !== undefined && serials.length !== input.quantity) {
    throw new DepthError(
      "serial_count_mismatch",
      `Serial count (${serials.length}) must equal the received quantity (${input.quantity}) for variant ${input.variantId}.`,
      { variantId: input.variantId, serialCount: serials.length, quantity: input.quantity },
    );
  }
  if (new Set(serials).size !== serials.length) {
    throw new DepthError("duplicate_serial", "The same serial appears twice in one receive line.", {
      variantId: input.variantId,
    });
  }
  if (serials.length > 0) {
    const existing = await tx.serialUnit.findMany({
      where: { variantId: input.variantId, serial: { in: serials } },
      select: { serial: true },
    });
    if (existing.length > 0) {
      throw new DepthError(
        "duplicate_serial",
        `Serial already recorded for this variant: ${existing[0]!.serial}`,
        { variantId: input.variantId, serial: existing[0]!.serial },
      );
    }
  }

  let batchId: string | null = null;
  const batchCode = input.batchCode?.trim() || null;
  if (batchCode) {
    const existingBatch = await tx.inventoryBatch.findFirst({
      where: { variantId: input.variantId, warehouseId: input.warehouseId, batchCode },
      select: { id: true, bin: true },
    });
    if (existingBatch) {
      batchId = existingBatch.id;
      await tx.inventoryBatch.update({
        where: { id: existingBatch.id },
        data: {
          quantityOnHand: { increment: input.quantity },
          ...(existingBatch.bin === null && input.bin ? { bin: input.bin } : {}),
        },
      });
    } else {
      const created = await tx.inventoryBatch.create({
        data: {
          variantId: input.variantId,
          warehouseId: input.warehouseId,
          batchCode,
          expiryDate: input.expiryDate ?? null,
          quantityOnHand: input.quantity,
          costPoisha: input.costPoisha,
          purchaseOrderId: input.purchaseOrderId,
          bin: input.bin?.trim() || null,
        },
        select: { id: true },
      });
      batchId = created.id;
    }
  }

  if (serials.length > 0) {
    await tx.serialUnit.createMany({
      data: serials.map((serial) => ({
        variantId: input.variantId,
        warehouseId: input.warehouseId,
        serial,
        status: "IN_STOCK",
        batchId,
      })),
    });
  }

  // Bin label on the canonical per-warehouse row (last receive wins —
  // the row describes where the variant currently sits in that
  // warehouse; ADV-21 pick lists read it).
  if (input.bin?.trim()) {
    await tx.inventoryItem.update({
      where: {
        variantId_warehouseId: { variantId: input.variantId, warehouseId: input.warehouseId },
      },
      data: { bin: input.bin.trim() },
    });
  }

  return { batchId };
}

/* ------------------------------------------------------------------ */
/* Delivery: serial SOLD marking + FEFO batch depletion              */
/* ------------------------------------------------------------------ */

export interface DeliveryDepthSummary {
  serialsMarkedSold: number;
  batchUnitsDepleted: number;
  /** True when the flag was off and nothing was written. */
  skippedFlagOff: boolean;
}

/**
 * Marks recorded serials SOLD (with the order ref) and depletes
 * batches FEFO for one DELIVERED order. Best-effort by contract: the
 * caller (delivered hooks) isolates failures, and this function also
 * never throws for missing/partial tracking — untracked units are
 * simply not recorded anywhere, exactly as before ADV-20.
 */
export async function applyDeliveryDepth(order: {
  id: string;
  items: { variantId: string; quantity: number }[];
}): Promise<DeliveryDepthSummary> {
  if (!isInventoryDepthEnabled()) {
    return { serialsMarkedSold: 0, batchUnitsDepleted: 0, skippedFlagOff: true };
  }
  let serialsMarkedSold = 0;
  let batchUnitsDepleted = 0;
  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      if (item.quantity <= 0) continue;
      // --- serials: count what this order already holds (replay-safe)
      const alreadySold = await tx.serialUnit.count({
        where: { variantId: item.variantId, status: "SOLD", orderId: order.id },
      });
      const need = item.quantity - alreadySold;
      if (need > 0) {
        const available = await tx.serialUnit.findMany({
          where: { variantId: item.variantId, status: "IN_STOCK" },
          orderBy: { createdAt: "asc" },
          take: need,
          select: { id: true },
        });
        if (available.length > 0) {
          const res = await tx.serialUnit.updateMany({
            where: { id: { in: available.map((u) => u.id) } },
            data: { status: "SOLD", orderId: order.id },
          });
          serialsMarkedSold += res.count;
        }
      }
      // --- batches: FEFO depletion across warehouses (orders carry
      // no warehouse; the batch sub-ledger is variant-level here).
      let remaining = item.quantity;
      const batches = await tx.inventoryBatch.findMany({
        where: { variantId: item.variantId, quantityOnHand: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: { id: true, quantityOnHand: true },
      });
      for (const batch of batches) {
        if (remaining <= 0) break;
        const take = Math.min(batch.quantityOnHand, remaining);
        await tx.inventoryBatch.update({
          where: { id: batch.id },
          data: { quantityOnHand: { decrement: take } },
        });
        batchUnitsDepleted += take;
        remaining -= take;
      }
    }
  });
  return { serialsMarkedSold, batchUnitsDepleted, skippedFlagOff: false };
}

/* ------------------------------------------------------------------ */
/* Return receive: flip SOLD serials back                             */
/* ------------------------------------------------------------------ */

export interface ReturnDepthSummary {
  restockedToInStock: number;
  markedReturned: number;
  skippedFlagOff: boolean;
}

/**
 * Flips the serials of one order after its return was received:
 * restockable quantities go SOLD → IN_STOCK (orderId cleared),
 * damaged quantities go SOLD → RETURNED (orderId kept). Quantities
 * are per variant, aggregated by the caller from the return lines.
 * Never throws — a flip failure must not fail a completed receive.
 */
export async function restoreSerialsForReturnDepth(input: {
  orderId: string;
  restockByVariant: ReadonlyMap<string, number>;
  damagedByVariant: ReadonlyMap<string, number>;
}): Promise<ReturnDepthSummary> {
  if (!isInventoryDepthEnabled()) {
    return { restockedToInStock: 0, markedReturned: 0, skippedFlagOff: true };
  }
  let restockedToInStock = 0;
  let markedReturned = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const variantIds = new Set([
        ...input.restockByVariant.keys(),
        ...input.damagedByVariant.keys(),
      ]);
      for (const variantId of variantIds) {
        const restockQty = input.restockByVariant.get(variantId) ?? 0;
        if (restockQty > 0) {
          const units = await tx.serialUnit.findMany({
            where: { variantId, status: "SOLD", orderId: input.orderId },
            orderBy: { updatedAt: "asc" },
            take: restockQty,
            select: { id: true },
          });
          if (units.length > 0) {
            const res = await tx.serialUnit.updateMany({
              where: { id: { in: units.map((u) => u.id) } },
              data: { status: "IN_STOCK", orderId: null },
            });
            restockedToInStock += res.count;
          }
        }
        const damagedQty = input.damagedByVariant.get(variantId) ?? 0;
        if (damagedQty > 0) {
          const units = await tx.serialUnit.findMany({
            where: { variantId, status: "SOLD", orderId: input.orderId },
            orderBy: { updatedAt: "asc" },
            take: damagedQty,
            select: { id: true },
          });
          if (units.length > 0) {
            const res = await tx.serialUnit.updateMany({
              where: { id: { in: units.map((u) => u.id) } },
              data: { status: "RETURNED" },
            });
            markedReturned += res.count;
          }
        }
      }
    });
  } catch (err) {
    console.error(`[inventory-depth] serial restore for order ${input.orderId} failed:`, err);
  }
  return { restockedToInStock, markedReturned, skippedFlagOff: false };
}
