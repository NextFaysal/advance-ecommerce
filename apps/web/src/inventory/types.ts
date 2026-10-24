// Inventory ledger types — Agent 5, Steps 23-24 (types only, no DB writes here).
// Invariant: stock changes ONLY via stock_movements. Direct quantity edits are forbidden.
import { z } from "zod";

export type StockMovementType =
  | "purchase_receive"
  | "sale_reserve"
  | "sale_commit"
  | "sale_release"
  | "sale_restore"
  | "adjustment"
  | "transfer_out"
  | "transfer_in"
  | "return_receive"
  | "damage";

export const stockMovementSchema = z.object({
  variantId: z.string().min(1),
  warehouseId: z.string().min(1),
  type: z.enum([
    "purchase_receive",
    "sale_reserve",
    "sale_commit",
    "sale_release",
    "sale_restore",
    "adjustment",
    "transfer_out",
    "transfer_in",
    "return_receive",
    "damage",
  ]),
  /** Signed delta: positive = stock in, negative = stock out. Zero is invalid. */
  quantityDelta: z.number().int().refine((n) => n !== 0, "quantityDelta must not be 0"),
  referenceType: z.enum(["order", "purchase", "adjustment", "transfer", "return"]),
  referenceId: z.string().min(1),
  reason: z.string().min(1),
  actorId: z.string().min(1),
});

export type StockMovementInput = z.infer<typeof stockMovementSchema>;

export interface StockMovement extends StockMovementInput {
  id: string;
  quantityBefore: number;
  quantityAfter: number;
  createdAt: string;
}

export interface InventoryItem {
  variantId: string;
  warehouseId: string;
  quantityOnHand: number;
  quantityReserved: number;
  /** Available = onHand - reserved. Never negative; a reservation that would make it negative is rejected. */
  quantityAvailable: number;
}
