// Stock ledger rules — Agent 5, Steps 23-24 (pure rules, no DB access).
// These rules are the contract the Step 23 service must enforce inside a DB transaction.
import type { InventoryItem, StockMovementType } from "./types";

/**
 * Reserve at checkout (TTL in Step 23 service): onHand unchanged, reserved += qty.
 * Rejected if qty > available. This function does not mutate its input.
 */
export function reserve(item: InventoryItem, qty: number): InventoryItem {
  if (qty <= 0) throw new Error("reserve qty must be positive");
  if (qty > item.quantityAvailable) throw new Error("insufficient available stock");
  return { ...item, quantityReserved: item.quantityReserved + qty, quantityAvailable: item.quantityAvailable - qty };
}

/** Commit on confirm (configurable: on place vs on confirm — default on confirm): reserved -= qty, onHand -= qty. */
export function commit(item: InventoryItem, qty: number): InventoryItem {
  if (qty <= 0) throw new Error("commit qty must be positive");
  if (qty > item.quantityReserved) throw new Error("cannot commit more than reserved");
  return {
    ...item,
    quantityOnHand: item.quantityOnHand - qty,
    quantityReserved: item.quantityReserved - qty,
    quantityAvailable: item.quantityAvailable,
  };
}

/** Release on cancel: reserved -= qty, onHand unchanged, available += qty. */
export function release(item: InventoryItem, qty: number): InventoryItem {
  if (qty <= 0) throw new Error("release qty must be positive");
  if (qty > item.quantityReserved) throw new Error("cannot release more than reserved");
  return { ...item, quantityReserved: item.quantityReserved - qty, quantityAvailable: item.quantityAvailable + qty };
}

/** Restore on return: onHand += qty (after QC decision in Step 23 service; damaged returns use damage, not restore). */
export function restore(item: InventoryItem, qty: number): InventoryItem {
  if (qty <= 0) throw new Error("restore qty must be positive");
  return { ...item, quantityOnHand: item.quantityOnHand + qty, quantityAvailable: item.quantityAvailable + qty };
}

/** Movement type -> signed onHand delta direction (0 = affects reserved only, not onHand). */
export const MOVEMENT_DELTA_SIGN: Record<StockMovementType, -1 | 0 | 1> = {
  purchase_receive: 1,
  sale_reserve: 0, // reserve affects reserved, not onHand — see reserve() above
  sale_commit: -1,
  sale_release: 0, // release affects reserved, not onHand — see release() above
  sale_restore: 1,
  adjustment: 1, // sign comes from quantityDelta itself; service must require an explicit reason
  transfer_out: -1,
  transfer_in: 1,
  return_receive: 1,
  damage: -1,
};
