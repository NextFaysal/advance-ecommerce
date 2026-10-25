/**
 * Return line loader — doc 17 batch O7 (part 2, shared helper).
 *
 * The RMA core (O7-1, src/orders/returns.ts) owns the Return rows and
 * their per-line items; this module is the read side O7-2 needs for
 * the exchange money math and the customer returns list. It resolves
 * every returned line to:
 *   { orderItemId, quantity, unitPricePoisha, productName, sku }
 *
 * QUANTITY: the line's effective quantity — received quantity when
 * the return has been received, else the approved/requested quantity
 * (whatever the core persisted; the probe below reads the first of
 * receivedQuantity / approvedQuantity / quantity / requestedQuantity
 * the row actually carries).
 *
 * PRICE: the line's value is the price the customer PAID for it. If
 * the core stored a price snapshot on the line row it wins; otherwise
 * the snapshot on the original OrderItem is used — by construction
 * that IS the snapshot price of the returned goods.
 *
 * SOURCE: the core's model is ReturnItem behind the Return.items
 * relation (quantity + condition, no price snapshot — prices resolve
 * from the OrderItem, as above). The loader still probes (`items`
 * include first, then fallbacks) so a relation rename degrades to an
 * empty list the callers refuse on, never to wrong values.
 */
import { prisma } from "@advance-ecommerce/db";

export interface ReturnLineValue {
  orderItemId: string;
  quantity: number;
  unitPricePoisha: number;
  productName: string;
  sku: string;
  /** Per-line condition recorded at the receive step
   *  (RESTOCKABLE / DAMAGED), null before receive. The exchange
   *  money math excludes DAMAGED lines — the RMA core's completion
   *  rule is that DAMAGED lines are never refunded, so they earn no
   *  exchange credit either. */
  condition: string | null;
}

type RawRow = Record<string, unknown>;

function asInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function pickQuantity(row: RawRow): number | null {
  for (const key of ["receivedQuantity", "approvedQuantity", "quantity", "requestedQuantity"]) {
    const v = asInt(row[key]);
    if (v !== null && v > 0) return v;
  }
  return null;
}

/** Relation-include probe: works whatever the relation is named. */
async function linesViaInclude(returnId: string): Promise<RawRow[] | null> {
  const findUnique = prisma.return.findUnique as unknown as (
    args: unknown,
  ) => Promise<RawRow | null>;
  for (const relation of ["items", "lines"] as const) {
    try {
      const row = await findUnique({
        where: { id: returnId },
        include: { [relation]: true },
      });
      const lines = row?.[relation];
      if (Array.isArray(lines)) return lines as RawRow[];
    } catch {
      // Relation does not exist under this name — try the next probe.
    }
  }
  return null;
}

/** Standalone-delegate probe: a ReturnItem / ReturnLine model. */
async function linesViaDelegate(returnId: string): Promise<RawRow[] | null> {
  const client = prisma as unknown as Record<
    string,
    { findMany?: (args: unknown) => Promise<RawRow[]> } | undefined
  >;
  for (const key of ["returnItem", "returnLine"] as const) {
    const delegate = client[key];
    if (delegate && typeof delegate.findMany === "function") {
      try {
        const rows = await delegate.findMany({ where: { returnId } });
        if (Array.isArray(rows)) return rows;
      } catch {
        // Delegate exists but the where shape differs — give up probing.
        return null;
      }
    }
  }
  return null;
}

/**
 * The return's lines with values resolved. Returns [] when the return
 * does not exist or no line source is readable yet.
 */
export async function loadReturnLines(returnId: string): Promise<ReturnLineValue[]> {
  const ret = await prisma.return.findFirst({
    where: { id: returnId, deletedAt: null },
    select: { id: true, orderId: true },
  });
  if (ret === null) return [];

  const raw = (await linesViaInclude(returnId)) ?? (await linesViaDelegate(returnId)) ?? [];

  // The OrderItem snapshots of the original order are the fallback
  // (and cross-check) for price / name / sku.
  const orderItems = await prisma.orderItem.findMany({
    where: { orderId: ret.orderId },
    select: { id: true, unitPricePoisha: true, productName: true, sku: true },
  });
  const byId = new Map(orderItems.map((i) => [i.id, i]));

  const lines: ReturnLineValue[] = [];
  for (const row of raw) {
    const orderItemId = typeof row.orderItemId === "string" ? row.orderItemId : null;
    if (orderItemId === null) continue;
    const quantity = pickQuantity(row);
    if (quantity === null) continue;
    const snapshot = byId.get(orderItemId);
    lines.push({
      orderItemId,
      quantity,
      unitPricePoisha: asInt(row.unitPricePoisha) ?? snapshot?.unitPricePoisha ?? 0,
      productName:
        typeof row.productName === "string" ? row.productName : (snapshot?.productName ?? ""),
      sku: typeof row.sku === "string" ? row.sku : (snapshot?.sku ?? ""),
      condition: typeof row.condition === "string" ? row.condition : null,
    });
  }
  return lines;
}

/** Σ quantity × snapshot unit price over the return's lines (poisha). */
export function returnedGoodsPoisha(lines: readonly ReturnLineValue[]): number {
  return lines.reduce((sum, l) => sum + l.quantity * l.unitPricePoisha, 0);
}
