// Advanced order types — Agent 16, Step 48 (A9).
// Money is integer poisha everywhere. Percentages are basis points, never floats.
import { z } from "zod";
import type { Order, OrderItem, OrderStatus } from "../orders/types";

export type WarehouseStock = {
  warehouseId: string;
  warehouseName: string;
  /** Priority: lower number is allocated from first. */
  priority: number;
  /** variantId -> units physically available in this warehouse. */
  availableByVariant: Record<string, number>;
};

export type ShipmentAllocationLine = {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPricePoisha: number;
};

export type SplitShipment = {
  shipmentKey: string;
  warehouseId: string;
  warehouseName: string;
  lines: ShipmentAllocationLine[];
  subtotalPoisha: number;
};

export type AllocationResult = {
  shipments: SplitShipment[];
  /** Lines that no warehouse could fully cover (backorder candidates). */
  unallocated: ShipmentAllocationLine[];
  fullyAllocated: boolean;
};

// ---- Partial delivery / payment ----

export type PartialDeliveryLine = {
  variantId: string;
  orderedQty: number;
  deliveredQty: number;
};

export type PartialPaymentState = {
  totalPoisha: number;
  paidPoisha: number;
  refundedPoisha: number;
};

export type DerivedPaymentStatus =
  | "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED" | "PARTIALLY_REFUNDED";

// ---- Exchange ----

export type ExchangeRequest = {
  orderId: string;
  returnedItem: OrderItem;
  returnedQty: number;
  replacementItem: OrderItem;
  replacementQty: number;
};

export type ExchangeComputation = {
  returnedValuePoisha: number;
  replacementValuePoisha: number;
  /** Positive: customer owes. Negative: store refunds. Zero: even swap. */
  differencePoisha: number;
  direction: "CUSTOMER_OWES" | "STORE_REFUNDS" | "EVEN";
};

// ---- Merge ----

export type MergeCandidate = Pick<
  Order,
  "id" | "orderNo" | "customerPhone" | "status" | "address" | "totalPoisha"
>;

export type MergeValidation = {
  ok: boolean;
  reasons: string[];
  mergedTotalPoisha: number | null;
};

// ---- Pre-order / backorder ----

export type PreOrderStatus = "OPEN" | "PARTIALLY_FULFILLED" | "FULFILLED" | "CANCELLED";

export const preOrderSchema = z.object({
  productVariantId: z.string().min(1),
  sku: z.string().min(1),
  customerPhone: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPricePoisha: z.number().int().nonnegative(),
  depositPoisha: z.number().int().nonnegative(),
  expectedDate: z.string().min(1), // ISO date
});
export type PreOrderInput = z.infer<typeof preOrderSchema>;

export interface PreOrder extends PreOrderInput {
  id: string;
  status: PreOrderStatus;
  fulfilledQty: number;
  createdAt: string;
}

export type BackorderLine = {
  orderId: string;
  variantId: string;
  sku: string;
  missingQty: number;
};

export const SHIPPED_OR_BEYOND: readonly OrderStatus[] = [
  "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURNING", "RETURNED", "REFUNDED", "EXCHANGED",
];
