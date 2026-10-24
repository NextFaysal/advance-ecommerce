// Stock validation at checkout — pure checks; live stock lives in the DB.
// Reservation policy (platform spec, configurable): reserve at checkout,
// commit on confirm, release/restore on cancel/return. All changes go through
// the stock_movements ledger — never a direct stock edit.
import type { CartItem } from "../cart/types";

export type StockProblem = {
  variantId: string;
  name: string;
  requested: number;
  available: number;
};

export function findStockProblems(items: CartItem[]): StockProblem[] {
  return items
    .filter((item) => item.quantity > item.availableStock)
    .map((item) => ({
      variantId: item.variantId,
      name: item.name,
      requested: item.quantity,
      available: item.availableStock,
    }));
}

export function isStockAvailable(items: CartItem[]): boolean {
  return findStockProblems(items).length === 0;
}
