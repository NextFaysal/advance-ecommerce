// TEMPORARY DEMO data — Agent 10. Used ONLY so admin UI / API routes render
// and can be tested before Prisma wiring. It is NOT real business data, is
// labelled in every response/UI, and must be deleted when DB queries land.
import type { InventoryItem } from "../inventory/types";
import type { SalesRow } from "./types";

export const DEMO_INVENTORY: InventoryItem[] = [
  { variantId: "var-1", warehouseId: "wh-main", quantityOnHand: 42, quantityReserved: 3, quantityAvailable: 39 },
  { variantId: "var-2", warehouseId: "wh-main", quantityOnHand: 4, quantityReserved: 1, quantityAvailable: 3 },
  { variantId: "var-3", warehouseId: "wh-main", quantityOnHand: 0, quantityReserved: 0, quantityAvailable: 0 },
];
export const DEMO_COST_POISHA: Record<string, number> = { "var-1": 65000, "var-2": 120000, "var-3": 99900 };
export const DEMO_LOW_STOCK_THRESHOLD = 5;

export function todayIso(): string { return new Date().toISOString().slice(0, 10); }
export function daysAgoIso(days: number): string { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }
export const DEMO_SALES_ROWS: SalesRow[] = [
  { orderId: "ord-1", date: todayIso(), customerId: "cus-1", district: "Dhaka", courier: "steadfast", productId: "prod-1", quantity: 2, revenuePoisha: 200000, costPoisha: 130000, shippingPoisha: 6000, refundPoisha: 0, status: "DELIVERED" },
  { orderId: "ord-2", date: daysAgoIso(2), customerId: "cus-2", district: "Chattogram", courier: "pathao", productId: "prod-2", quantity: 1, revenuePoisha: 150000, costPoisha: 120000, shippingPoisha: 12000, refundPoisha: 0, status: "SHIPPED" },
  { orderId: "ord-3", date: daysAgoIso(9), customerId: "cus-1", district: "Dhaka", courier: "steadfast", productId: "prod-1", quantity: 1, revenuePoisha: 100000, costPoisha: 65000, shippingPoisha: 6000, refundPoisha: 0, status: "DELIVERED" },
];
