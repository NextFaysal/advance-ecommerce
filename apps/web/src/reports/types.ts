// Reports types — Agent 10, Steps 28/30-33. All money is integer poisha.
import { z } from "zod";
import { isValidQtyNumber } from "../lib/quantity";

// Mirrors the full Prisma OrderStatus enum so DB-built rows are lossless
// (FAILED / RETURN_REQUESTED / RETURNING / EXCHANGED included).
export const SALES_STATUSES = ["PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "FAILED", "RETURN_REQUESTED", "RETURNING", "CANCELLED", "RETURNED", "REFUNDED", "EXCHANGED"] as const;
export const salesRowSchema = z.object({
  orderId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerId: z.string().min(1),
  district: z.string().min(1),
  courier: z.string().nullable(),
  productId: z.string().min(1),
  // Wave 59: line quantities may be fractional (weighted goods).
  quantity: z.number().refine((n) => isValidQtyNumber(n), "quantity must be positive, max 3 decimals"),
  revenuePoisha: z.number().int().min(0),
  costPoisha: z.number().int().min(0),
  shippingPoisha: z.number().int().min(0),
  refundPoisha: z.number().int().min(0).default(0),
  status: z.enum(SALES_STATUSES),
});
export type SalesRow = z.infer<typeof salesRowSchema>;

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine((v) => v.from <= v.to, "from must be <= to");
export type DateRange = z.infer<typeof dateRangeSchema>;

export interface Totals {
  orders: number;
  units: number;
  revenuePoisha: number;
  costPoisha: number;
  shippingPoisha: number;
  refundPoisha: number;
  grossProfitPoisha: number;
  netRevenuePoisha: number;
}
export interface ReportBundle {
  range: DateRange;
  totals: Totals;
  byProduct: Record<string, Totals>;
  byCustomer: Record<string, Totals>;
  byCourier: Record<string, Totals>;
  byDistrict: Record<string, Totals>;
  comparison: { previous: Totals; revenueDeltaPercent: number | null } | null;
}
// Sample P&L type: grossProfit = revenue - cost; netRevenue = revenue - refunds.
