/**
 * Order editing (doc 17 batch O6) — transactional line edits for an
 * order that has not shipped yet, plus the read view the admin edit
 * panel consumes.
 *
 * WHY THIS EXISTS: before this module an order's lines and totals
 * were frozen at create; staff had to cancel + recreate to fix a
 * quantity, which lost the order number, the advance/OTP state and
 * the history. Edits here keep the same order and recompute the
 * money exactly the way create does (same pricing identity, same
 * shipping engine, same coupon evaluator, same VAT split).
 *
 * STOCK: create reserves every ordinary line (guarded decrement +
 * SALE_RESERVE movement; see reserveOrderLineItems in repository.ts —
 * deliberately NOT exported, so the two delta helpers below mirror
 * its ledger shape exactly). Because releaseOrderStockReservations()
 * recomputes outstanding reserves from the movement ledger, an
 * edit's SALE_RESERVE / SALE_RELEASE delta movements compose with
 * it: a later CANCEL releases precisely what is still reserved.
 * A failed claim (oversell) throws inside the transaction, so the
 * WHOLE edit rolls back — no partial edits, ever.
 *
 * BUNDLE LINES: while the product-types flag is ON, bundle variants
 * are pricing shells whose stock lives in component reservations
 * (deductBundleComponents at create). Editing such a line here
 * would desync the component ledger, so any edit TOUCHING a bundle
 * line is refused (BUNDLE_LINE_NOT_EDITABLE); staff cancel +
 * recreate instead. With the flag OFF, bundle variants reserve like
 * ordinary lines (create semantics) and edit normally.
 *
 * SHIPPING: recomputed with computeOrderShipping (district-derived
 * zone, new line weight, new merchandise subtotal — the free-above
 * threshold applies exactly as at create). Two deliberate
 * preservations:
 *  - A staff shipping OVERRIDE on a manual order is persisted only
 *    as an order note ("ডেলিভারি চার্জ কর্মীর নির্ধারিত X পয়সা …",
 *    written by manual-create) — when that note exists, X stays the
 *    delivery charge whatever the engine says.
 *  - A stored shippingPoisha of 0 with no override is treated as a
 *    deliberate zero (pickup / free delivery): an edit never RAISES
 *    a zero delivery charge. (The coupon re-evaluation below can
 *    still zero a positive charge, and can also REMOVE a coupon —
 *    see the coupon rule.)
 *
 * COUPON: the order's applied coupon is identified from its
 * CouponUsage row (the same source orderRowToEnriched reads). It is
 * re-evaluated against the NEW subtotal with evaluateOrderCoupon:
 *  - still eligible  → the discount is recomputed (percent/fixed
 *    scale with the subtotal; a free-shipping coupon zeroes the
 *    recomputed shipping) and the CouponUsage row's discountPoisha
 *    is updated in the same transaction;
 *  - no longer eligible (min-cart missed, expired, ...) → the
 *    discount is removed, the CouponUsage row is DELETED in the
 *    same transaction (the reversal engine's cancel convention),
 *    the checkout coupon snapshot is refreshed after commit, and
 *    the timeline note says the coupon was removed and why;
 *  - the order's OWN usage is inside the evaluator's snapshot
 *    counts, so this order's one usage is subtracted from the
 *    record's usedCount/usedByUser for the duration of the
 *    (synchronous) evaluation and restored in a finally — otherwise
 *    a per-user-limit-1 coupon would always reject its own order.
 * An order whose discount came from a coupon with NO DB usage row
 * (legacy/demo path) keeps its discountPoisha untouched: the code
 * is not persisted anywhere, so there is nothing truthful to
 * re-evaluate — the timeline note flags that case.
 *
 * VAT: when the order row carries vatRateBps (recorded at create
 * from Settings), the split is recomputed from the new total at
 * THAT recorded rate via computeVatInclusiveSplit — the same
 * function create uses. Orders without a recorded rate keep NULL.
 *
 * ADVANCE: the persisted advanceRequiredPoisha is NEVER changed by
 * an edit. When an advance-bearing order's total moves, the
 * timeline note flags the mismatch for staff (the advance panel
 * surfaces required vs paid; collecting/refunding the difference
 * stays a staff decision through the payment/refund funnels).
 */
import { prisma } from "@advance-ecommerce/db";
import { productTypesEnabledInDb, type ProductTypesTx } from "../catalog/product-types";
import { computeOrderShipping, zoneForDistrict } from "../checkout/shipping";
import {
  evaluateOrderCoupon,
  findOrderCoupon,
} from "../checkout/order-enrichment";
import { refreshCouponSnapshot } from "../marketing/repository";
import { writeAudit } from "../lib/audit";
import {
  addQty,
  cmpQty,
  isValidQtyNumber,
  lineTotalPoisha,
  qtyNumber,
  qtyToDecimalString,
  qtyToMilli,
  roundHalfUpDiv,
  stockClaimUnits,
  QTY_MILLI,
} from "../lib/quantity";
import { validateOrderLineQuantities } from "./quantity-rules";
import {
  computeVatInclusiveSplit,
  getVariantSnapshots,
  type ServerVariantSnapshot,
} from "./repository";

/* ------------------------------------------------------------------ */
/* Result contract (mirrors src/orders/refunds.ts)                     */
/* ------------------------------------------------------------------ */

export type OrderEditErrorCode =
  | "ORDER_NOT_FOUND"
  | "INVALID_INPUT"
  | "ITEM_NOT_FOUND"
  | "VARIANT_NOT_FOUND"
  | "EMPTY_ORDER"
  | "ORDER_NOT_EDITABLE"
  | "INSUFFICIENT_STOCK"
  | "BUNDLE_LINE_NOT_EDITABLE";

export type OrderEditResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: OrderEditErrorCode; error: string };

const fail = (
  code: OrderEditErrorCode,
  error: string,
): { ok: false; code: OrderEditErrorCode; error: string } => ({ ok: false, code, error });

/** Internal rollback signal: thrown inside the edit transaction and
 *  converted to a typed result outside it. */
class EditAbort extends Error {
  constructor(
    public code: OrderEditErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface OrderEditActor {
  id: string;
  ip?: string;
  userAgent?: string;
}

export interface OrderItemEdits {
  setQuantities?: { orderItemId: string; quantity: number }[];
  removeItemIds?: string[];
  addItems?: {
    variantId: string;
    quantity: number;
    /**
     * Server-trusted price override for the added line (doc 34 §3.7,
     * funnel upsell runtime). Callers are SERVER code that derived
     * the price from a stored discount rule + the live catalog —
     * never client input. The service validates it against its own
     * snapshot inside the transaction: it must be an integer >= 1
     * and <= the catalog price (a caller may only discount, never
     * mark up), and it aborts when the variant already has a kept
     * line at a different price (merging would misprice one of the
     * units). Absent = the catalog snapshot price, as always. Staff
     * routes never send it.
     */
    unitPricePoisha?: number;
  }[];
}

export interface OrderMoney {
  subtotalPoisha: number;
  discountPoisha: number;
  shippingPoisha: number;
  codFeePoisha: number;
  totalPoisha: number;
}

export interface OrderEditOutcome {
  orderId: string;
  orderNo: string;
  before: OrderMoney;
  after: OrderMoney;
  linesChanged: { added: number; removed: number; quantityChanged: number };
  couponRemoved: boolean;
  couponCode: string | null;
}

/** Statuses whose orders may still be edited: nothing has left the
 *  building and no terminal/reversal state has been entered. */
export const EDITABLE_ORDER_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED"] as const;

/* ------------------------------------------------------------------ */
/* Stock delta ledger (mirrors reserveOrderLineItems' shape)           */
/* ------------------------------------------------------------------ */

async function defaultWarehouse(tx: ProductTypesTx) {
  return tx.warehouse.findFirst({
    where: { deletedAt: null, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
}

/**
 * Apply per-variant reservation deltas inside the edit transaction.
 * Positive delta = claim more (guarded decrement + SALE_RESERVE);
 * negative = release (increment + SALE_RELEASE). Deltas of 0 are
 * skipped. Throws EditAbort(INSUFFICIENT_STOCK) on a failed claim,
 * rolling back the whole edit — exactly create's claim discipline.
 */
async function applyStockDeltas(
  tx: ProductTypesTx,
  order: { id: string; orderNo: string },
  deltas: Map<string, number>,
): Promise<void> {
  const entries = [...deltas.entries()]
    .filter(([, d]) => d !== 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (entries.length === 0) return;
  const warehouse = await defaultWarehouse(tx);
  for (const [variantId, delta] of entries) {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { stock: true, sku: true },
    });
    if (!variant) {
      throw new EditAbort(
        "VARIANT_NOT_FOUND",
        `পণ্যের ভ্যারিয়েন্ট পাওয়া যায়নি / Variant ${variantId} no longer exists.`,
      );
    }
    if (delta > 0) {
      const claimed = await tx.productVariant.updateMany({
        where: { id: variantId, deletedAt: null, stock: { gte: delta } },
        data: { stock: { decrement: delta } },
      });
      if (claimed.count !== 1) {
        throw new EditAbort(
          "INSUFFICIENT_STOCK",
          `স্টক অপর্যাপ্ত: ${variant.sku} — আছে ${variant.stock}, আরও ${delta} প্রয়োজন / Insufficient stock for ${variant.sku}: ${variant.stock} available, ${delta} more required.`,
        );
      }
      if (!warehouse) {
        console.warn(
          `[orders] edit reserve for order ${order.orderNo}: no warehouse for the ledger movement (variant ${variantId}, qty ${delta}) — stock cache moved, movement skipped.`,
        );
        continue;
      }
      const afterRow = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true },
      });
      const after = afterRow?.stock ?? variant.stock - delta;
      await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId: warehouse.id,
          type: "SALE_RESERVE",
          quantityDelta: -delta,
          quantityBefore: after + delta,
          quantityAfter: after,
          referenceType: "ORDER",
          referenceId: order.id,
          reason: `Order edit: stock reserve increase for order ${order.orderNo}`,
          actorId: null,
        },
      });
      await tx.inventoryItem.upsert({
        where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
        create: { variantId, warehouseId: warehouse.id, quantityOnHand: after, quantityReserved: delta },
        update: { quantityOnHand: after, quantityReserved: { increment: delta } },
      });
    } else {
      const release = -delta;
      const restored = await tx.productVariant.updateMany({
        where: { id: variantId },
        data: { stock: { increment: release } },
      });
      if (restored.count !== 1 || !warehouse) {
        if (restored.count !== 1) {
          console.warn(
            `[orders] edit release for order ${order.orderNo}: variant ${variantId} vanished — cache not restored.`,
          );
        }
        continue;
      }
      const afterRow = await tx.productVariant.findUnique({
        where: { id: variantId },
        select: { stock: true },
      });
      if (!afterRow) continue;
      const after = afterRow.stock;
      await tx.stockMovement.create({
        data: {
          variantId,
          warehouseId: warehouse.id,
          type: "SALE_RELEASE",
          quantityDelta: release,
          quantityBefore: after - release,
          quantityAfter: after,
          referenceType: "ORDER",
          referenceId: order.id,
          reason: `Order edit: stock reservation released for order ${order.orderNo}`,
          actorId: null,
        },
      });
      await tx.inventoryItem.upsert({
        where: { variantId_warehouseId: { variantId, warehouseId: warehouse.id } },
        create: { variantId, warehouseId: warehouse.id, quantityOnHand: after, quantityReserved: 0 },
        update: { quantityOnHand: after, quantityReserved: { decrement: release } },
      });
    }
  }
}

/* ------------------------------------------------------------------ */
/* Staff shipping override detection                                   */
/* ------------------------------------------------------------------ */

/** manual-create persists a staff shipping override ONLY inside the
 *  order note text: "ডেলিভারি চার্জ কর্মীর নির্ধারিত X পয়সা (…)".
 *  The LAST such note wins (a later manual touch would supersede). */
const SHIPPING_OVERRIDE_RE = /ডেলিভারি চার্জ কর্মীর নির্ধারিত\s+(\d+)\s*পয়সা/;

function detectStaffShippingOverride(notes: { text: string }[]): number | null {
  let found: number | null = null;
  for (const n of notes) {
    const m = SHIPPING_OVERRIDE_RE.exec(n.text);
    if (m) found = Number.parseInt(m[1], 10);
  }
  return found;
}

/* ------------------------------------------------------------------ */
/* Edit view (GET for the panel)                                       */
/* ------------------------------------------------------------------ */

export interface OrderEditLineView {
  orderItemId: string;
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
}

export interface OrderEditView {
  orderId: string;
  orderNo: string;
  status: string;
  editable: boolean;
  notEditableReasonBn: string | null;
  notEditableReasonEn: string | null;
  lines: OrderEditLineView[];
  totals: OrderMoney;
}

const NOT_EDITABLE_BN = "এই অর্ডারের অবস্থায় আর সম্পাদনা করা যাবে না (পাঠানো/সম্পন্ন/বাতিল হয়ে গেছে)।";
const NOT_EDITABLE_EN = "This order can no longer be edited (already shipped, completed or cancelled).";

export async function getOrderEditView(idOrNo: string): Promise<OrderEditResult<OrderEditView>> {
  const row = await prisma.order.findFirst({
    where: { deletedAt: null, OR: [{ id: idOrNo }, { orderNo: idOrNo }] },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  if (!row) return fail("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");
  const editable = (EDITABLE_ORDER_STATUSES as readonly string[]).includes(row.status);
  return {
    ok: true,
    value: {
      orderId: row.id,
      orderNo: row.orderNo,
      status: row.status,
      editable,
      notEditableReasonBn: editable ? null : NOT_EDITABLE_BN,
      notEditableReasonEn: editable ? null : NOT_EDITABLE_EN,
      lines: row.items.map((i) => ({
        orderItemId: i.id,
        variantId: i.variantId,
        productName: i.productName,
        sku: i.sku,
        unitPricePoisha: i.unitPricePoisha,
        quantity: qtyNumber(i.quantity),
      })),
      totals: {
        subtotalPoisha: row.subtotalPoisha,
        discountPoisha: row.discountPoisha,
        shippingPoisha: row.shippingPoisha,
        codFeePoisha: row.codFeePoisha,
        totalPoisha: row.totalPoisha,
      },
    },
  };
}

/* ------------------------------------------------------------------ */
/* The edit                                                            */
/* ------------------------------------------------------------------ */

interface PlannedLine {
  orderItemId: string | null; // null = newly added
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
}

export async function editOrderItems(
  orderId: string,
  edits: OrderItemEdits,
  actor: OrderEditActor,
): Promise<OrderEditResult<OrderEditOutcome>> {
  const setQuantities = edits.setQuantities ?? [];
  const removeItemIds = edits.removeItemIds ?? [];
  const addItems = edits.addItems ?? [];
  if (setQuantities.length === 0 && removeItemIds.length === 0 && addItems.length === 0) {
    return fail("INVALID_INPUT", "কোনো পরিবর্তন পাঠানো হয়নি / No changes were submitted.");
  }
  // Wave 59: quantities may be fractional (<= 3 decimals) — fractions
  // are then gated to weighted variants on the planned lines below.
  for (const s of setQuantities) {
    if (!(s.quantity === 0 || isValidQtyNumber(s.quantity)) || s.quantity > 999) {
      return fail("INVALID_INPUT", "পরিমাণ ০–৯৯৯ এর মধ্যে হতে হবে / Quantity must be between 0 and 999.");
    }
  }
  for (const a of addItems) {
    if (!isValidQtyNumber(a.quantity) || a.quantity > 999) {
      return fail("INVALID_INPUT", "নতুন আইটেমের পরিমাণ ১–৯৯৯ হতে হবে / Added item quantity must be between 1 and 999.");
    }
    if (
      a.unitPricePoisha !== undefined &&
      (!Number.isInteger(a.unitPricePoisha) || a.unitPricePoisha < 1)
    ) {
      return fail("INVALID_INPUT", "যোগ করা আইটেমের দাম অবশ্যই ধনাত্মক পূর্ণসংখ্যা (পয়সা) হতে হবে / An added item's price override must be a positive integer (poisha).");
    }
  }

  let outcome: OrderEditOutcome | null = null;
  let couponRemovedNeedsRefresh = false;
  try {
    outcome = await prisma.$transaction(async (tx) => {
      const row = await tx.order.findFirst({
        where: { id: orderId, deletedAt: null },
        include: {
          items: { orderBy: { createdAt: "asc" } },
          notes: { orderBy: { createdAt: "asc" }, select: { text: true } },
          couponUsages: { include: { coupon: { select: { code: true } } } },
        },
      });
      if (!row) {
        throw new EditAbort("ORDER_NOT_FOUND", "অর্ডার পাওয়া যায়নি / Order not found.");
      }
      if (!(EDITABLE_ORDER_STATUSES as readonly string[]).includes(row.status)) {
        throw new EditAbort(
          "ORDER_NOT_EDITABLE",
          `এই অর্ডার এখন ${row.status} অবস্থায় — সম্পাদনা করা যাবে না / This order is ${row.status} and can no longer be edited.`,
        );
      }

      const before: OrderMoney = {
        subtotalPoisha: row.subtotalPoisha,
        discountPoisha: row.discountPoisha,
        shippingPoisha: row.shippingPoisha,
        codFeePoisha: row.codFeePoisha,
        totalPoisha: row.totalPoisha,
      };

      /* ---- resolve the edit into a final line plan ---- */
      const byId = new Map(row.items.map((i) => [i.id, i]));
      const removedIds = new Set<string>();
      for (const id of removeItemIds) {
        if (!byId.has(id)) {
          throw new EditAbort("ITEM_NOT_FOUND", `আইটেম পাওয়া যায়নি / Order item not found: ${id}`);
        }
        removedIds.add(id);
      }
      const qtyByItemId = new Map<string, number>();
      for (const s of setQuantities) {
        const item = byId.get(s.orderItemId);
        if (!item) {
          throw new EditAbort("ITEM_NOT_FOUND", `আইটেম পাওয়া যায়নি / Order item not found: ${s.orderItemId}`);
        }
        if (removedIds.has(s.orderItemId)) {
          throw new EditAbort(
            "INVALID_INPUT",
            "একই আইটেমে সরানো ও পরিমাণ বদল একসাথে করা যাবে না / An item cannot be both removed and quantity-set in one edit.",
          );
        }
        if (s.quantity === 0) removedIds.add(s.orderItemId);
        else qtyByItemId.set(s.orderItemId, s.quantity);
      }

      const lines: PlannedLine[] = [];
      let quantityChanged = 0;
      for (const item of row.items) {
        if (removedIds.has(item.id)) continue;
        // Wave 59: stored quantities are Decimals — canonicalise
        // before comparing/planning in app numbers.
        const storedQty = qtyNumber(item.quantity);
        const qty = qtyByItemId.get(item.id) ?? storedQty;
        if (cmpQty(qty, storedQty) !== 0) quantityChanged += 1;
        lines.push({
          orderItemId: item.id,
          variantId: item.variantId,
          productName: item.productName,
          sku: item.sku,
          unitPricePoisha: item.unitPricePoisha,
          quantity: qty,
        });
      }

      // Snapshots for every variant the plan touches (existing kept
      // lines included — the shipping weight needs them all).
      const involvedVariantIds = [
        ...new Set([
          ...lines.map((l) => l.variantId),
          ...addItems.map((a) => a.variantId),
          ...row.items.filter((i) => removedIds.has(i.id)).map((i) => i.variantId),
        ]),
      ];
      const snapshots: Map<string, ServerVariantSnapshot> = await getVariantSnapshots(involvedVariantIds);

      // Bundle guard (flag ON): refuse to touch bundle lines at all.
      const typesEnabled = await productTypesEnabledInDb();
      if (typesEnabled) {
        const touchedVariantIds = new Set<string>([
          ...[...qtyByItemId.keys()].map((id) => byId.get(id)?.variantId ?? ""),
          ...[...removedIds].map((id) => byId.get(id)?.variantId ?? ""),
          ...addItems.map((a) => a.variantId),
        ]);
        for (const vid of touchedVariantIds) {
          if (vid && snapshots.get(vid)?.productType === "BUNDLE") {
            throw new EditAbort(
              "BUNDLE_LINE_NOT_EDITABLE",
              "বান্ডল আইটেম সম্পাদনা করা যাবে না — বান্ডলের স্টক তার উপাদানগুলোতে সংরক্ষিত থাকে। প্রয়োজনে অর্ডার বাতিল করে নতুন করে তৈরি করুন / Bundle lines cannot be edited — bundle stock is reserved on its components. Cancel and recreate the order instead.",
            );
          }
        }
      }

      // Adds: priced at the CURRENT catalog, snapshotted like create.
      // An add whose variant already has a kept line merges into it
      // (create aggregates duplicate lines the same way). A priced
      // add (unitPricePoisha set — the funnel runtime's discounted
      // upsell line) is validated against the snapshot: discount
      // only, never above catalog; a kept line at a DIFFERENT price
      // refuses the merge, because one line cannot carry two prices.
      let addedCount = 0;
      const pricedAdds: { sku: string; catalogPoisha: number; chargedPoisha: number }[] = [];
      for (const add of addItems) {
        const snap = snapshots.get(add.variantId);
        if (!snap) {
          throw new EditAbort(
            "VARIANT_NOT_FOUND",
            `পণ্যের ভ্যারিয়েন্ট পাওয়া যায়নি / Variant not found: ${add.variantId}`,
          );
        }
        if (add.unitPricePoisha !== undefined && add.unitPricePoisha > snap.unitPricePoisha) {
          throw new EditAbort(
            "INVALID_INPUT",
            `ছাড়ের দাম ক্যাটালগ দামের বেশি হতে পারে না / A priced add may not exceed the catalog price (${snap.sku}: ${add.unitPricePoisha} > ${snap.unitPricePoisha}).`,
          );
        }
        const existing = lines.find((l) => l.variantId === add.variantId);
        if (existing) {
          if (add.unitPricePoisha !== undefined && add.unitPricePoisha !== existing.unitPricePoisha) {
            throw new EditAbort(
              "INVALID_INPUT",
              `এই ভ্যারিয়েন্টটি অর্ডারে অন্য দামে আছে — ছাড়ের দামে মার্জ করা যাবে না / Variant ${snap.sku} is already on the order at a different price — a priced add cannot merge into it.`,
            );
          }
          existing.quantity = addQty(existing.quantity, add.quantity);
          quantityChanged += 1;
        } else {
          lines.push({
            orderItemId: null,
            variantId: snap.variantId,
            productName: snap.productName,
            sku: snap.sku,
            unitPricePoisha: add.unitPricePoisha ?? snap.unitPricePoisha,
            quantity: add.quantity,
          });
        }
        if (add.unitPricePoisha !== undefined && add.unitPricePoisha < snap.unitPricePoisha) {
          pricedAdds.push({ sku: snap.sku, catalogPoisha: snap.unitPricePoisha, chargedPoisha: add.unitPricePoisha });
        }
        addedCount += 1;
      }

      if (lines.length === 0) {
        throw new EditAbort(
          "EMPTY_ORDER",
          "অর্ডারে অন্তত একটি আইটেম থাকতে হবে — সব আইটেম সরানো যাবে না / An order must keep at least one item; removing every line is not an edit, cancel the order instead.",
        );
      }

      // Wave 59: the planned lines must satisfy the same weighted
      // gate as create (fractions only on weighted variants, on the
      // configured weight step) — an edit can never smuggle in a
      // fraction create would refuse.
      const qtyGate = await validateOrderLineQuantities(lines);
      if (!qtyGate.ok) {
        throw new EditAbort("INVALID_INPUT", qtyGate.message);
      }

      /* ---- stock deltas (per variant, whole-edit atomic) ---- */
      const oldQtyByVariant = new Map<string, number>();
      for (const i of row.items) {
        oldQtyByVariant.set(i.variantId, addQty(oldQtyByVariant.get(i.variantId) ?? 0, i.quantity));
      }
      const newQtyByVariant = new Map<string, number>();
      for (const l of lines) {
        newQtyByVariant.set(l.variantId, addQty(newQtyByVariant.get(l.variantId) ?? 0, l.quantity));
      }
      const deltas = new Map<string, number>();
      for (const vid of new Set([...oldQtyByVariant.keys(), ...newQtyByVariant.keys()])) {
        // Stock moves in whole units: the delta is between the two
        // sides' stockClaimUnits totals (identity for integer lines),
        // matching the reservation claim the create placed.
        deltas.set(
          vid,
          stockClaimUnits(newQtyByVariant.get(vid) ?? 0) - stockClaimUnits(oldQtyByVariant.get(vid) ?? 0),
        );
      }
      await applyStockDeltas(tx, { id: row.id, orderNo: row.orderNo }, deltas);

      /* ---- persist the lines ---- */
      for (const id of removedIds) {
        await tx.orderItem.delete({ where: { id } });
      }
      for (const line of lines) {
        if (line.orderItemId === null) {
          await tx.orderItem.create({
            data: {
              orderId: row.id,
              variantId: line.variantId,
              productName: line.productName,
              sku: line.sku,
              unitPricePoisha: line.unitPricePoisha,
              quantity: qtyToDecimalString(line.quantity),
            },
          });
        } else {
          // Covers both an explicit setQuantities change and a
          // merged add that raised this kept line's quantity.
          const original = byId.get(line.orderItemId);
          if (original && cmpQty(line.quantity, original.quantity) !== 0) {
            await tx.orderItem.update({
              where: { id: line.orderItemId },
              data: { quantity: qtyToDecimalString(line.quantity) },
            });
          }
        }
      }

      /* ---- pricing: subtotal + shipping engine ---- */
      const subtotalPoisha = lines.reduce((sum, l) => sum + lineTotalPoisha(l.unitPricePoisha, l.quantity), 0);
      const totalWeightGrams = lines.reduce(
        (sum, l) => sum + roundHalfUpDiv((snapshots.get(l.variantId)?.weightGrams ?? 0) * qtyToMilli(l.quantity), QTY_MILLI),
        0,
      );
      const engine = await computeOrderShipping({
        district: row.district,
        shippingMethod: zoneForDistrict(row.district),
        totalWeightGrams,
        subtotalPoisha,
      });
      const overridePoisha = detectStaffShippingOverride(row.notes);
      const baseShippingPoisha =
        overridePoisha !== null
          ? overridePoisha
          : row.shippingPoisha === 0
            ? 0
            : engine.shippingPoisha;
      let shippingPoisha = baseShippingPoisha;
      const codFeePoisha = row.paymentMethod === "COD" ? engine.codFeePoisha : 0;

      /* ---- coupon re-evaluation ---- */
      const usage = row.couponUsages[0] ?? null;
      let discountPoisha = row.discountPoisha;
      let couponRemoved = false;
      let couponNote: string | null = null;
      if (usage) {
        const code = usage.coupon.code;
        let record = findOrderCoupon(code);
        if (!record) {
          // Cold process: the snapshot may not have loaded this
          // coupon yet — refresh once before judging it missing.
          await refreshCouponSnapshot();
          record = findOrderCoupon(code);
        }
        if (record) {
          // Exclude THIS order's own usage from the evaluator's
          // counts for the duration of the evaluation, restoring
          // exactly what was subtracted in the finally.
          const userKeys = [row.customerPhone, row.customerId].filter(
            (k): k is string => typeof k === "string" && k.length > 0,
          );
          const countDecremented = record.usedCount > 0;
          if (countDecremented) record.usedCount -= 1;
          const decrementedKeys: string[] = [];
          for (const k of userKeys) {
            if (record.usedByUser[k]) {
              record.usedByUser[k] -= 1;
              decrementedKeys.push(k);
            }
          }
          let outcome;
          try {
            const priorCount = await tx.order.count({
              where: { customerId: row.customerId, createdAt: { lt: row.createdAt } },
            });
            outcome = evaluateOrderCoupon({
              code,
              subtotalPoisha,
              shippingPoisha: baseShippingPoisha,
              userKey: row.customerPhone,
              isFirstOrder: priorCount === 0,
            });
          } finally {
            if (countDecremented) record.usedCount += 1;
            for (const k of decrementedKeys) record.usedByUser[k] += 1;
          }
          if (outcome.status === "applied") {
            discountPoisha = outcome.discountPoisha;
            shippingPoisha = outcome.shippingPoisha;
            if (usage.discountPoisha !== discountPoisha) {
              await tx.couponUsage.update({
                where: { id: usage.id },
                data: { discountPoisha },
              });
            }
          } else {
            discountPoisha = 0;
            shippingPoisha = baseShippingPoisha;
            await tx.couponUsage.delete({ where: { id: usage.id } });
            couponRemoved = true;
            couponRemovedNeedsRefresh = true;
            couponNote = `কুপন ${code} সরিয়ে দেওয়া হয়েছে — নতুন সাবটোটালে শর্ত পূরণ হয়নি (${outcome.reasonBn ?? "শর্ত পূরণ হয়নি"}) / Coupon ${code} was removed — it is no longer eligible at the new subtotal (${outcome.reasonEn ?? "ineligible"}).`;
          }
        } else {
          couponNote = `কুপন ${code} যাচাই করা যায়নি (কুপন রেকর্ড পাওয়া যায়নি) — ছাড় আগের মতোই রাখা হয়েছে / Coupon ${code} could not be re-evaluated (no coupon record found) — the discount was left unchanged.`;
        }
      } else if (row.discountPoisha > 0) {
        couponNote =
          "নোট: এই অর্ডারের ছাড় কোনো ডাটাবেস কুপন রেকর্ডের সাথে যুক্ত নয়, তাই ছাড়টি পুনরায় যাচাই করা হয়নি / Note: this order's discount has no database coupon record, so it was not re-evaluated.";
      }
      const totalPoisha = subtotalPoisha - discountPoisha + shippingPoisha + codFeePoisha + row.taxPoisha;
      const vatPoisha =
        row.vatRateBps !== null && row.vatRateBps !== undefined
          ? computeVatInclusiveSplit(totalPoisha, row.vatRateBps).vatPoisha
          : null;

      await tx.order.update({
        where: { id: row.id },
        data: {
          subtotalPoisha,
          discountPoisha,
          shippingPoisha,
          codFeePoisha,
          totalPoisha,
          vatPoisha,
        },
      });

      /* ---- timeline note ---- */
      const changeBits: string[] = [];
      if (addedCount > 0) changeBits.push(`${addedCount}টি নতুন আইটেম / ${addedCount} item(s) added`);
      if (removedIds.size > 0) changeBits.push(`${removedIds.size}টি আইটেম সরানো / ${removedIds.size} item(s) removed`);
      if (quantityChanged > 0) changeBits.push(`${quantityChanged}টি আইটেমের পরিমাণ বদল / ${quantityChanged} quantity change(s)`);
      let noteText =
        `অর্ডার সম্পাদনা (${changeBits.join(", ")}): মোট ${before.totalPoisha} → ${totalPoisha} পয়সা ` +
        `(সাবটোটাল ${before.subtotalPoisha} → ${subtotalPoisha}, ছাড় ${before.discountPoisha} → ${discountPoisha}, ডেলিভারি ${before.shippingPoisha} → ${shippingPoisha})। / ` +
        `Order edited (${changeBits.join(", ")}): total ${before.totalPoisha} → ${totalPoisha} poisha ` +
        `(subtotal ${before.subtotalPoisha} → ${subtotalPoisha}, discount ${before.discountPoisha} → ${discountPoisha}, shipping ${before.shippingPoisha} → ${shippingPoisha}).`;
      if (couponNote) noteText += ` ${couponNote}`;
      for (const p of pricedAdds) {
        noteText +=
          ` ছাড়ের দামে যোগ: ${p.sku} — ক্যাটালগ দাম ${p.catalogPoisha} পয়সা, নেওয়া হয়েছে ${p.chargedPoisha} পয়সা (ফানেল অফারের নিয়ম অনুযায়ী)। / ` +
          `Priced add: ${p.sku} — catalog price ${p.catalogPoisha} poisha, charged ${p.chargedPoisha} poisha (funnel offer rule).`;
      }
      if (row.advanceRequiredPoisha > 0 && totalPoisha !== before.totalPoisha) {
        noteText +=
          ` ⚠ অগ্রিম পেমেন্ট: এই অর্ডারে ${row.advanceRequiredPoisha} পয়সা অগ্রিম নির্ধারিত ছিল (আগের মোট ${before.totalPoisha}); সম্পাদনার পর মোট ${totalPoisha} — অগ্রিমের পরিমাণ বদলানো হয়নি, কর্মীদের মিলিয়ে দেখতে হবে। / ` +
          `Advance: ${row.advanceRequiredPoisha} poisha was required against the previous total ${before.totalPoisha}; the edited total is ${totalPoisha} — the requirement itself was NOT changed, staff must reconcile the difference.`;
      }
      const author = await tx.user.findUnique({ where: { id: actor.id }, select: { id: true } });
      await tx.orderNote.create({
        data: { orderId: row.id, authorId: author?.id ?? null, text: noteText },
      });

      return {
        orderId: row.id,
        orderNo: row.orderNo,
        before,
        after: {
          subtotalPoisha,
          discountPoisha,
          shippingPoisha,
          codFeePoisha,
          totalPoisha,
        },
        linesChanged: { added: addedCount, removed: removedIds.size, quantityChanged },
        couponRemoved,
        couponCode: usage?.coupon.code ?? null,
      } satisfies OrderEditOutcome;
    });
  } catch (e) {
    if (e instanceof EditAbort) return fail(e.code, e.message);
    throw e;
  }
  if (!outcome) return fail("INVALID_INPUT", "সম্পাদনা সম্পন্ন হয়নি / The edit did not complete.");
  if (couponRemovedNeedsRefresh) {
    // Mirror the reversal engine: once a usage row is deleted, the
    // checkout coupon snapshot must recount before the next
    // evaluation anywhere in this process.
    await refreshCouponSnapshot();
  }
  await writeAudit({
    actorId: actor.id,
    action: "orders.edit",
    entityType: "Order",
    entityId: outcome.orderId,
    beforeJson: { ...outcome.before },
    afterJson: {
      ...outcome.after,
      linesChanged: outcome.linesChanged,
      couponRemoved: outcome.couponRemoved,
      couponCode: outcome.couponCode,
    },
    ip: actor.ip,
    userAgent: actor.userAgent,
  });
  return { ok: true, value: outcome };
}
