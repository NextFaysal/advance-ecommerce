// Inventory service — Agent 10, Steps 23-24.
// Pure ledger logic on top of Agent 5 ledger rules. Money is integer poisha.
// Persistence: an explicit InventoryStore interface (in-memory, below).
// The Prisma-backed implementation lives in src/inventory/repository.ts:
// it runs planMovement() inside a DB transaction with a row lock, so the
// in-memory and DB paths share EXACTLY the same movement rules.
// Stock changes ONLY via stock_movements; there is no direct quantity edit.
import { z } from "zod";
import { commit, release, reserve, restore } from "./ledger";
import type { InventoryItem, StockMovement, StockMovementInput } from "./types";

export const movementActionSchema = z.object({
  variantId: z.string().min(1),
  warehouseId: z.string().min(1),
  action: z.enum(["reserve", "commit", "release", "restore", "adjust", "purchase_receive", "transfer_out", "transfer_in", "damage"]),
  quantity: z.number().int().positive(),
  referenceType: z.enum(["order", "purchase", "adjustment", "transfer", "return"]),
  referenceId: z.string().min(1),
  reason: z.string().min(1),
  actorId: z.string().min(1),
  // For transfer: destination warehouse. For adjust/damage: signed handling is
  // via action, quantity stays positive and the service applies the sign.
  toWarehouseId: z.string().min(1).optional(),
  // Reservation TTL (ms) for checkout reservations; expiry itself is a job
  // (Step 23 service + BullMQ) — the service records expiresAt, it does not
  // silently expire stock here.
  ttlMs: z.number().int().positive().optional(),
});
export type MovementAction = z.infer<typeof movementActionSchema>;

export interface InventoryStore {
  getItem(variantId: string, warehouseId: string): InventoryItem | undefined;
  putItem(item: InventoryItem): void;
  listItems(): InventoryItem[];
  appendMovement(m: StockMovement): void;
  listMovements(variantId?: string): StockMovement[];
}

export class InMemoryInventoryStore implements InventoryStore {
  private items = new Map<string, InventoryItem>();
  private movements: StockMovement[] = [];
  constructor(seed: InventoryItem[] = []) {
    for (const it of seed) this.items.set(`${it.variantId}:${it.warehouseId}`, { ...it });
  }
  getItem(variantId: string, warehouseId: string) {
    const it = this.items.get(`${variantId}:${warehouseId}`);
    return it ? { ...it } : undefined;
  }
  putItem(item: InventoryItem) {
    this.items.set(`${item.variantId}:${item.warehouseId}`, { ...item });
  }
  listItems() {
    return [...this.items.values()].map((i) => ({ ...i }));
  }
  appendMovement(m: StockMovement) {
    this.movements.push({ ...m });
  }
  listMovements(variantId?: string) {
    return this.movements.filter((m) => !variantId || m.variantId === variantId).map((m) => ({ ...m }));
  }
}

const ACTION_TO_MOVEMENT: Record<MovementAction["action"], StockMovementInput["type"]> = {
  reserve: "sale_reserve",
  commit: "sale_commit",
  release: "sale_release",
  restore: "sale_restore",
  adjust: "adjustment",
  purchase_receive: "purchase_receive",
  transfer_out: "transfer_out",
  transfer_in: "transfer_in",
  damage: "damage",
};

/**
 * Pure movement planning: given the current item, compute the next item
 * and the signed movement quantityDelta. Throws on insufficient stock /
 * over-commit / over-release (the ledger rules). Shared verbatim by the
 * in-memory applyMovement() and the Prisma repository (repository.ts),
 * so both persistence paths enforce identical semantics.
 */
export function planMovement(
  before: InventoryItem,
  input: MovementAction,
): { after: InventoryItem; quantityDelta: number; type: StockMovementInput["type"] } {
  let after: InventoryItem;
  switch (input.action) {
    case "reserve": after = reserve(before, input.quantity); break;
    case "commit": after = commit(before, input.quantity); break;
    case "release": after = release(before, input.quantity); break;
    case "restore": after = restore(before, input.quantity); break;
    case "purchase_receive": case "transfer_in":
      after = { ...before, quantityOnHand: before.quantityOnHand + input.quantity, quantityAvailable: before.quantityAvailable + input.quantity }; break;
    case "transfer_out": case "damage":
      if (input.quantity > before.quantityAvailable) throw new Error("insufficient available stock");
      after = { ...before, quantityOnHand: before.quantityOnHand - input.quantity, quantityAvailable: before.quantityAvailable - input.quantity }; break;
    case "adjust":
      // Adjust is an explicit, reason-required correction, not a silent edit:
      // callers must use purchase_receive / damage for normal in/out.
      // Here adjust is treated as an inbound correction; outbound corrections
      // must use damage with a reason. This keeps the sign unambiguous.
      after = { ...before, quantityOnHand: before.quantityOnHand + input.quantity, quantityAvailable: before.quantityAvailable + input.quantity }; break;
    default: throw new Error("unknown movement action");
  }
  // OnHand delta for the movement row: reserve/release only touch reserved.
  const onHandDelta = input.action === "reserve" || input.action === "release" ? 0
    : input.action === "transfer_out" || input.action === "damage" ? -input.quantity : input.quantity;
  return {
    after,
    quantityDelta: onHandDelta === 0 ? input.quantity : onHandDelta,
    type: ACTION_TO_MOVEMENT[input.action],
  };
}

export function applyMovement(store: InventoryStore, input: MovementAction): { item: InventoryItem; movement: StockMovement } {
  const before = store.getItem(input.variantId, input.warehouseId) ?? {
    variantId: input.variantId,
    warehouseId: input.warehouseId,
    quantityOnHand: 0,
    quantityReserved: 0,
    quantityAvailable: 0,
  };
  const planned = planMovement(before, input);
  const after = planned.after;
  const movement: StockMovement = {
    id: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    variantId: input.variantId,
    warehouseId: input.warehouseId,
    type: planned.type,
    quantityDelta: planned.quantityDelta,
    referenceType: input.referenceType,
    referenceId: input.referenceId,
    reason: input.reason,
    actorId: input.actorId,
    quantityBefore: before.quantityOnHand,
    quantityAfter: after.quantityOnHand,
    createdAt: new Date().toISOString(),
  };
  store.putItem(after);
  store.appendMovement(movement);
  if (input.action === "transfer_out" && input.toWarehouseId) {
    // Mirror leg of a transfer: destination receives the same quantity.
    // In a Prisma implementation both legs MUST be in one DB transaction.
    applyMovement(store, { ...input, action: "transfer_in", warehouseId: input.toWarehouseId, toWarehouseId: undefined, referenceType: "transfer" });
  }
  return { item: after, movement };
}

export interface LowStockRow extends InventoryItem {
  threshold: number;
  isLow: boolean;
}
export function lowStockList(store: InventoryStore, threshold: number): LowStockRow[] {
  return store.listItems()
    .map((i) => ({ ...i, threshold, isLow: i.quantityAvailable <= threshold }))
    .filter((r) => r.isLow)
    .sort((a, b) => a.quantityAvailable - b.quantityAvailable);
}

/** Valuation in integer poisha: sum(onHand * costPoisha). Cost is never 0 by default — caller must supply it. */
export function valuationPoisha(items: InventoryItem[], costPoishaByVariant: Record<string, number>): number {
  let total = 0;
  for (const it of items) {
    const cost = costPoishaByVariant[it.variantId];
    if (cost === undefined) throw new Error(`missing costPoisha for variant ${it.variantId}`);
    total += it.quantityOnHand * cost;
  }
  return total;
}

// Purchase order / supplier — stub service (in-memory, no payment, no goods-receive accounting yet).
export const purchaseOrderSchema = z.object({
  supplierId: z.string().min(1),
  supplierName: z.string().min(1),
  warehouseId: z.string().min(1),
  items: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive(), costPoisha: z.number().int().min(0) })).min(1),
  note: z.string().optional(),
});
export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export interface PurchaseOrder extends PurchaseOrderInput {
  id: string;
  status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
  totalPoisha: number;
  createdAt: string;
}
export function createPurchaseOrder(input: PurchaseOrderInput): PurchaseOrder {
  const totalPoisha = input.items.reduce((s, i) => s + i.quantity * i.costPoisha, 0);
  return { ...input, id: `po_${Date.now()}`, status: "draft", totalPoisha, createdAt: new Date().toISOString() };
}
