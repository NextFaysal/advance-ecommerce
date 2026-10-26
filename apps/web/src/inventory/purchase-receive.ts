/**
 * Purchase-order goods receiving — ADV-11b (doc 22).
 *
 * THE GAP THIS FILLS: the ADV-11 audit found purchase models
 * (Supplier / PurchaseOrder / PurchaseOrderItem) with NO receive flow
 * anywhere — nothing ever wrote PurchaseOrderItem.quantityReceived,
 * PurchaseOrder.receivedAt, or the PARTIALLY_RECEIVED / RECEIVED
 * statuses, purchase_receive stock movements carried no PO reference,
 * and the ERP purchase posting (src/erp/auto-posting.ts
 * postPurchaseReceivedErp) had no live caller. This module is that
 * caller-side funnel.
 *
 * receivePurchaseOrder() runs in ONE prisma.$transaction:
 *   1. the PurchaseOrder row is locked (SELECT ... FOR UPDATE) so two
 *      concurrent receives of the same PO serialise — the second one
 *      re-reads quantityReceived under the lock and its over-receive
 *      check sees the first one's writes;
 *   2. per requested line: quantityReceived += quantity, after an
 *      over-receive check (quantityReceived + quantity must not
 *      exceed quantityOrdered). ANY invalid line throws and the WHOLE
 *      receive rolls back — a multi-line receive is atomic, never
 *      half-booked;
 *   3. stock enters through the canonical ledger seam
 *      (applyMovementInTx from ./repository — InventoryItem row lock,
 *      planMovement() rules, StockMovement row, ProductVariant.stock
 *      cache re-sync): one PURCHASE_RECEIVE movement per line with
 *      referenceType "purchase" and referenceId = the PO id (or
 *      "<poId>:<idempotencyKey>" when the caller supplies a key), so
 *      receive history is exactly the movements booked against the PO;
 *   4. PO status becomes PARTIALLY_RECEIVED, or RECEIVED when every
 *      line is fully received; receivedAt is set on the FIRST receipt
 *      (left untouched afterwards).
 *
 * WHICH STATUSES CAN BE RECEIVED: DRAFT and ORDERED. No
 * order-placement transition exists anywhere in the codebase (PO
 * creation writes DRAFT and nothing ever set ORDERED), so refusing
 * DRAFT would make receiving impossible; receiving is the act that
 * moves a PO forward. CANCELLED (and soft-deleted) POs refuse.
 *
 * WAREHOUSE: movements must land in a warehouse. The PO's own
 * warehouseId wins; a PO without one falls back to the default
 * warehouse — the catalog adapter's convention (first active,
 * non-deleted warehouse by createdAt). With no warehouse at all the
 * receive fails with no_warehouse_available and writes nothing.
 *
 * IDEMPOTENCY: pass idempotencyKey to make a request safely
 * retryable. If movements already exist for "<poId>:<key>", the call
 * is a replay: nothing is written and the current PO state is
 * returned with idempotentReplay: true. Without a key, a repeated
 * partial receive is indistinguishable from a new legitimate one and
 * WILL book again (up to the ordered cap) — the admin UI therefore
 * generates one key per receive intent and disables double-submit.
 *
 * ERP POSTING — CONVENTION MISMATCH (reported, not papered over):
 * postPurchaseReceivedErp posts the PO's CUMULATIVE recorded received
 * value (Σ quantityReceived × costPoisha) exactly once per PO —
 * appendOnce on (sourceKind "purchase_received", sourceId = poId) —
 * and its signature accepts no receive-event identity, so per-receive
 * DELTA posting is impossible without changing that module (out of
 * scope here). Calling it after a partial receive would freeze a
 * partial total as the PO's only journal entry and silently drop
 * every later delta. It is therefore called ONLY when a receive
 * completes the PO (transition INTO RECEIVED): the single entry then
 * equals the full recorded received value. Consequences, stated
 * plainly: a PO that is never fully received gets NO journal entry
 * (the ERP purchase-ledger read model still reports its received
 * value from the PO rows), and if module.erp_lite is OFF at the
 * completing receive, no entry is posted later either.
 *
 * Post-commit side effects mirror applyMovementDb's discipline:
 * back-in-stock notification fires for variants whose canonical stock
 * crossed 0 -> positive; the ERP call is isolated (it never throws,
 * and its result — posted / already_posted / skipped+reason — is
 * surfaced in the return value, never hidden). Nothing in this module
 * invents a received quantity: quantities come only from the caller's
 * explicit receive lines.
 */
import { prisma } from "@advance-ecommerce/db";
import { postPurchaseReceivedErp, type AutoPostResult } from "../erp/auto-posting";
import { notifyBackInStockForVariant } from "../storefront-ux/back-in-stock-notify";
import { DepthError, isInventoryDepthEnabled, recordReceiveDepthInTx } from "./batches";
import { applyMovementInTx, resolveActorId } from "./repository";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type PurchaseReceiveErrorCode =
  | "purchase_order_not_found"
  | "purchase_order_cancelled"
  | "no_warehouse_available"
  | "empty_receive"
  | "duplicate_line"
  | "item_not_on_order"
  | "invalid_quantity"
  | "over_receive"
  // ADV-20 inventory-depth capture failures (src/inventory/batches.ts)
  | "serial_count_mismatch"
  | "duplicate_serial"
  | "invalid_expiry_date"
  | "expiry_without_batch"
  | "inventory_depth_disabled";

export class PurchaseReceiveError extends Error {
  readonly code: PurchaseReceiveErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: PurchaseReceiveErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "PurchaseReceiveError";
    this.code = code;
    this.details = details;
  }
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface ReceiveLineInput {
  itemId: string;
  quantity: number;
  /**
   * ADV-20 inventory-depth capture (all optional; gated by the
   * module.inventory_depth flag — providing any of them with the
   * flag OFF rejects the whole receive, recorded data is never
   * silently dropped):
   *  - batchCode/expiryDate: the lot this quantity arrived in;
   *  - bin: shelf label for the lot + the variant's warehouse row;
   *  - serials: one entry per unit; the count MUST equal quantity.
   */
  batchCode?: string;
  /** ISO date/datetime string; stored on the batch's first receipt. */
  expiryDate?: string;
  bin?: string;
  serials?: string[];
}

export interface ReceivePurchaseOrderInput {
  purchaseOrderId: string;
  lines: ReceiveLineInput[];
  actorId: string;
  idempotencyKey?: string;
  reason?: string;
}

export interface ReceivedLineResult {
  itemId: string;
  variantId: string;
  /** Quantity booked by THIS call (0 on an idempotent replay). */
  quantityReceivedNow: number;
  quantityReceivedTotal: number;
  quantityOrdered: number;
  remaining: number;
}

export type PurchaseOrderStatusWord =
  | "draft"
  | "ordered"
  | "partially_received"
  | "received"
  | "cancelled";

export interface ReceivePurchaseOrderResult {
  purchaseOrderId: string;
  status: PurchaseOrderStatusWord;
  warehouseId: string;
  /** True when the PO had no warehouse and the default was used. */
  warehouseIsDefault: boolean;
  /** Σ quantity × costPoisha booked by THIS call (0 on replay). */
  receivedValueDeltaPoisha: number;
  lines: ReceivedLineResult[];
  idempotentReplay: boolean;
  /** ERP posting outcome; only attempted when this call completed
   *  the PO (see header). null = not attempted. */
  erpPosting: AutoPostResult | null;
}

const STATUS_FROM_DB: Record<string, PurchaseOrderStatusWord> = {
  DRAFT: "draft",
  ORDERED: "ordered",
  PARTIALLY_RECEIVED: "partially_received",
  RECEIVED: "received",
  CANCELLED: "cancelled",
};

/* ------------------------------------------------------------------ */
/* Receive                                                             */
/* ------------------------------------------------------------------ */

interface TxOutcome {
  status: PurchaseOrderStatusWord;
  warehouseId: string;
  warehouseIsDefault: boolean;
  receivedValueDeltaPoisha: number;
  lines: ReceivedLineResult[];
  idempotentReplay: boolean;
  variantIds: string[];
}

export async function receivePurchaseOrder(
  input: ReceivePurchaseOrderInput,
): Promise<ReceivePurchaseOrderResult> {
  const poId = input.purchaseOrderId;
  if (!input.lines || input.lines.length === 0) {
    throw new PurchaseReceiveError("empty_receive", "At least one receive line is required.");
  }
  const seenItems = new Set<string>();
  for (const line of input.lines) {
    if (seenItems.has(line.itemId)) {
      throw new PurchaseReceiveError("duplicate_line", `Duplicate receive line for item ${line.itemId}.`, {
        itemId: line.itemId,
      });
    }
    seenItems.add(line.itemId);
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new PurchaseReceiveError("invalid_quantity", "Receive quantity must be a positive integer.", {
        itemId: line.itemId,
        quantity: line.quantity,
      });
    }
    if (line.expiryDate !== undefined && Number.isNaN(Date.parse(line.expiryDate))) {
      throw new PurchaseReceiveError("invalid_expiry_date", "Batch expiry date is not a valid date.", {
        itemId: line.itemId,
        expiryDate: line.expiryDate,
      });
    }
    if (line.expiryDate !== undefined && (!line.batchCode || line.batchCode.trim() === "")) {
      throw new PurchaseReceiveError(
        "expiry_without_batch",
        "An expiry date needs a batch code — expiry is recorded on the batch, never dropped.",
        { itemId: line.itemId },
      );
    }
  }
  // ADV-20: depth capture is all-or-nothing with the flag. A receive
  // naming batches/serials while the module is OFF is rejected whole —
  // the alternative (booking stock, dropping the lot data) would make
  // recorded units silently untracked.
  const usesDepth = input.lines.some(
    (l) =>
      (l.batchCode !== undefined && l.batchCode.trim() !== "") ||
      l.expiryDate !== undefined ||
      (l.bin !== undefined && l.bin.trim() !== "") ||
      l.serials !== undefined,
  );
  if (usesDepth && !isInventoryDepthEnabled()) {
    throw new PurchaseReceiveError(
      "inventory_depth_disabled",
      "Batch/serial capture requires the module.inventory_depth feature flag.",
    );
  }
  const referenceId = input.idempotencyKey ? `${poId}:${input.idempotencyKey}` : poId;
  const reason =
    input.reason?.trim() ||
    "Purchase order receive (admin)";

  // Canonical stock BEFORE the transaction, for the back-in-stock
  // 0 -> positive crossing check after commit (applyMovementDb's
  // discipline, mirrored because this flow books via applyMovementInTx
  // inside its own transaction).
  const requestedItemIds = input.lines.map((l) => l.itemId);
  const poPeek = await prisma.purchaseOrder.findUnique({
    where: { id: poId },
    select: { items: { where: { id: { in: requestedItemIds } }, select: { variantId: true } } },
  });
  const variantIds = [...new Set((poPeek?.items ?? []).map((i) => i.variantId))];
  const stockBefore = new Map<string, number>();
  if (variantIds.length > 0) {
    const rows = await prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      select: { id: true, stock: true },
    });
    for (const r of rows) stockBefore.set(r.id, r.stock);
  }

  const outcome = await prisma.$transaction(async (tx): Promise<TxOutcome> => {
    // Serialise concurrent receives of the same PO.
    await tx.$queryRaw`SELECT "id" FROM "PurchaseOrder" WHERE "id" = ${poId} FOR UPDATE`;
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { items: true },
    });
    if (!po || po.deletedAt) {
      throw new PurchaseReceiveError("purchase_order_not_found", `Purchase order not found: ${poId}`);
    }
    if (po.status === "CANCELLED") {
      throw new PurchaseReceiveError("purchase_order_cancelled", "A cancelled purchase order cannot receive goods.");
    }

    const itemsById = new Map(po.items.map((i) => [i.id, i]));
    for (const line of input.lines) {
      if (!itemsById.has(line.itemId)) {
        throw new PurchaseReceiveError("item_not_on_order", `Item ${line.itemId} is not on purchase order ${poId}.`, {
          itemId: line.itemId,
        });
      }
    }

    // Idempotent replay: this exact (PO, key) request already booked.
    if (input.idempotencyKey) {
      const existing = await tx.stockMovement.findFirst({
        where: { referenceType: "purchase", referenceId },
        select: { id: true },
      });
      if (existing) {
        return {
          status: STATUS_FROM_DB[po.status] ?? "draft",
          warehouseId: po.warehouseId ?? "",
          warehouseIsDefault: false,
          receivedValueDeltaPoisha: 0,
          lines: input.lines.map((line) => {
            const item = itemsById.get(line.itemId)!;
            return {
              itemId: item.id,
              variantId: item.variantId,
              quantityReceivedNow: 0,
              quantityReceivedTotal: item.quantityReceived,
              quantityOrdered: item.quantityOrdered,
              remaining: item.quantityOrdered - item.quantityReceived,
            };
          }),
          idempotentReplay: true,
          variantIds: [],
        };
      }
    }

    // Over-receive is checked for EVERY line before anything writes.
    for (const line of input.lines) {
      const item = itemsById.get(line.itemId)!;
      const remaining = item.quantityOrdered - item.quantityReceived;
      if (line.quantity > remaining) {
        throw new PurchaseReceiveError(
          "over_receive",
          `Receiving ${line.quantity} exceeds the remaining ${remaining} for item ${line.itemId}.`,
          {
            itemId: line.itemId,
            variantId: item.variantId,
            quantityOrdered: item.quantityOrdered,
            quantityAlreadyReceived: item.quantityReceived,
            quantityRequested: line.quantity,
            remaining,
          },
        );
      }
    }

    // Warehouse: the PO's own, else the default (catalog convention:
    // first active, non-deleted warehouse by createdAt).
    let warehouseId = po.warehouseId;
    let warehouseIsDefault = false;
    if (!warehouseId) {
      const fallback = await tx.warehouse.findFirst({
        where: { deletedAt: null, isActive: true },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!fallback) {
        throw new PurchaseReceiveError(
          "no_warehouse_available",
          "The purchase order has no warehouse and no active warehouse exists to receive into.",
        );
      }
      warehouseId = fallback.id;
      warehouseIsDefault = true;
    }

    const actorId = await resolveActorId(tx, input.actorId);
    const lineResults: ReceivedLineResult[] = [];
    let receivedValueDeltaPoisha = 0;
    const newReceivedByItem = new Map<string, number>();
    for (const line of input.lines) {
      const item = itemsById.get(line.itemId)!;
      const newTotal = item.quantityReceived + line.quantity;
      newReceivedByItem.set(item.id, newTotal);
      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { quantityReceived: newTotal },
      });
      await applyMovementInTx(
        tx,
        {
          variantId: item.variantId,
          warehouseId,
          action: "purchase_receive",
          quantity: line.quantity,
          referenceType: "purchase",
          referenceId,
          reason,
          actorId: input.actorId,
        },
        actorId,
      );
      // ADV-20 depth capture for this line, INSIDE the same
      // transaction: a serial/batch problem rolls the whole receive
      // back (no half-booked stock without its lot data).
      if (
        (line.batchCode !== undefined && line.batchCode.trim() !== "") ||
        line.expiryDate !== undefined ||
        (line.bin !== undefined && line.bin.trim() !== "") ||
        line.serials !== undefined
      ) {
        try {
          await recordReceiveDepthInTx(tx, {
            variantId: item.variantId,
            warehouseId,
            quantity: line.quantity,
            costPoisha: item.costPoisha,
            purchaseOrderId: poId,
            batchCode: line.batchCode,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
            bin: line.bin,
            serials: line.serials,
          });
        } catch (err) {
          if (err instanceof DepthError) {
            throw new PurchaseReceiveError(err.depthCode, err.message, err.details);
          }
          throw err;
        }
      }
      receivedValueDeltaPoisha += line.quantity * item.costPoisha;
      lineResults.push({
        itemId: item.id,
        variantId: item.variantId,
        quantityReceivedNow: line.quantity,
        quantityReceivedTotal: newTotal,
        quantityOrdered: item.quantityOrdered,
        remaining: item.quantityOrdered - newTotal,
      });
    }

    const allReceived = po.items.every(
      (i) => (newReceivedByItem.get(i.id) ?? i.quantityReceived) >= i.quantityOrdered,
    );
    const newStatus = allReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: {
        status: newStatus,
        ...(po.receivedAt ? {} : { receivedAt: new Date() }),
      },
    });

    return {
      status: STATUS_FROM_DB[newStatus] ?? "partially_received",
      warehouseId,
      warehouseIsDefault,
      receivedValueDeltaPoisha,
      lines: lineResults,
      idempotentReplay: false,
      variantIds,
    };
  });

  // Back-in-stock: a variant whose canonical stock crossed 0 ->
  // positive may have waiting signups (fire-and-forget, never throws
  // into the receive result).
  if (!outcome.idempotentReplay && outcome.variantIds.length > 0) {
    const rows = await prisma.productVariant
      .findMany({ where: { id: { in: outcome.variantIds } }, select: { id: true, stock: true } })
      .catch(() => []);
    for (const r of rows) {
      if ((stockBefore.get(r.id) ?? 0) <= 0 && r.stock > 0) {
        void notifyBackInStockForVariant(r.id).catch(() => undefined);
      }
    }
  }

  // ERP: per-PO-total posting convention — only the receive that
  // COMPLETES the PO triggers it (see header for the mismatch this
  // avoids). postPurchaseReceivedErp never throws; its skipped /
  // already_posted outcomes are surfaced, not hidden.
  let erpPosting: AutoPostResult | null = null;
  if (!outcome.idempotentReplay && outcome.status === "received") {
    erpPosting = await postPurchaseReceivedErp(poId).catch(
      (): AutoPostResult => ({ status: "skipped", reason: "posting_call_failed" }),
    );
  }

  return {
    purchaseOrderId: poId,
    status: outcome.status,
    warehouseId: outcome.warehouseId,
    warehouseIsDefault: outcome.warehouseIsDefault,
    receivedValueDeltaPoisha: outcome.receivedValueDeltaPoisha,
    lines: outcome.lines,
    idempotentReplay: outcome.idempotentReplay,
    erpPosting,
  };
}

/* ------------------------------------------------------------------ */
/* Read model for the admin receive panel                              */
/* ------------------------------------------------------------------ */

export interface PurchaseReceiveLineDetail {
  itemId: string;
  variantId: string;
  sku: string | null;
  productTitleBn: string | null;
  quantityOrdered: number;
  quantityReceived: number;
  remaining: number;
  costPoisha: number;
  receivedValuePoisha: number;
}

export interface PurchaseReceiveHistoryEntry {
  id: string;
  variantId: string;
  quantityDelta: number;
  quantityAfter: number;
  actorId: string | null;
  reason: string;
  createdAt: string;
}

export interface PurchaseReceiveDetail {
  id: string;
  supplierId: string;
  supplierName: string;
  status: PurchaseOrderStatusWord;
  warehouseId: string | null;
  /** Warehouse the next receive would book into (PO's own, else the
   *  default) and whether that is the default fallback. Null when no
   *  warehouse exists at all. */
  effectiveWarehouseId: string | null;
  warehouseIsDefault: boolean;
  note: string | null;
  totalPoisha: number;
  receivedValuePoisha: number;
  receivedAt: string | null;
  createdAt: string;
  lines: PurchaseReceiveLineDetail[];
  history: PurchaseReceiveHistoryEntry[];
  /** ADV-20: batches first recorded against this PO + how many serial
   *  units each carries. Serials received without a batch code carry
   *  no PO link and are not attributable here (panel copy says so). */
  batches: PurchaseReceiveBatchDetail[];
}

export interface PurchaseReceiveBatchDetail {
  batchId: string;
  batchCode: string;
  variantId: string;
  sku: string | null;
  warehouseId: string;
  expiryDate: string | null;
  quantityOnHand: number;
  costPoisha: number | null;
  bin: string | null;
  serialCount: number;
}

export async function getPurchaseReceiveDetailDb(
  purchaseOrderId: string,
): Promise<PurchaseReceiveDetail | null> {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: {
      supplier: { select: { id: true, name: true } },
      items: true,
    },
  });
  if (!po || po.deletedAt) return null;

  const variantIds = [...new Set(po.items.map((i) => i.variantId))];
  const variantRows = variantIds.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: { id: true, sku: true, product: { select: { titleBn: true } } },
      })
    : [];
  const variantMeta = new Map(variantRows.map((v) => [v.id, v]));

  let effectiveWarehouseId = po.warehouseId;
  let warehouseIsDefault = false;
  if (!effectiveWarehouseId) {
    const fallback = await prisma.warehouse.findFirst({
      where: { deletedAt: null, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    effectiveWarehouseId = fallback?.id ?? null;
    warehouseIsDefault = fallback !== null;
  }

  const movements = await prisma.stockMovement.findMany({
    where: {
      type: "PURCHASE_RECEIVE",
      referenceType: "purchase",
      OR: [{ referenceId: po.id }, { referenceId: { startsWith: `${po.id}:` } }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const batchRows = await prisma.inventoryBatch.findMany({
    where: { purchaseOrderId: po.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      batchCode: true,
      variantId: true,
      warehouseId: true,
      expiryDate: true,
      quantityOnHand: true,
      costPoisha: true,
      bin: true,
    },
  });
  const serialCounts = batchRows.length
    ? await prisma.serialUnit.groupBy({
        by: ["batchId"],
        where: { batchId: { in: batchRows.map((b) => b.id) } },
        _count: { _all: true },
      })
    : [];
  const serialCountByBatch = new Map(
    serialCounts.map((g) => [g.batchId, g._count._all] as const),
  );

  return {
    id: po.id,
    supplierId: po.supplier.id,
    supplierName: po.supplier.name,
    status: STATUS_FROM_DB[po.status] ?? "draft",
    warehouseId: po.warehouseId,
    effectiveWarehouseId,
    warehouseIsDefault,
    note: po.note,
    totalPoisha: po.totalPoisha,
    receivedValuePoisha: po.items.reduce((s, i) => s + i.quantityReceived * i.costPoisha, 0),
    receivedAt: po.receivedAt?.toISOString() ?? null,
    createdAt: po.createdAt.toISOString(),
    lines: po.items.map((i) => ({
      itemId: i.id,
      variantId: i.variantId,
      sku: variantMeta.get(i.variantId)?.sku ?? null,
      productTitleBn: variantMeta.get(i.variantId)?.product.titleBn ?? null,
      quantityOrdered: i.quantityOrdered,
      quantityReceived: i.quantityReceived,
      remaining: i.quantityOrdered - i.quantityReceived,
      costPoisha: i.costPoisha,
      receivedValuePoisha: i.quantityReceived * i.costPoisha,
    })),
    history: movements.map((m) => ({
      id: m.id,
      variantId: m.variantId,
      quantityDelta: m.quantityDelta,
      quantityAfter: m.quantityAfter,
      actorId: m.actorId,
      reason: m.reason,
      createdAt: m.createdAt.toISOString(),
    })),
    batches: batchRows.map((b) => ({
      batchId: b.id,
      batchCode: b.batchCode,
      variantId: b.variantId,
      sku: variantMeta.get(b.variantId)?.sku ?? null,
      warehouseId: b.warehouseId,
      expiryDate: b.expiryDate?.toISOString() ?? null,
      quantityOnHand: b.quantityOnHand,
      costPoisha: b.costPoisha,
      bin: b.bin,
      serialCount: serialCountByBatch.get(b.id) ?? 0,
    })),
  };
}
