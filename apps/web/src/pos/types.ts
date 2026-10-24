/**
 * POS domain types — Agent 14 (Step 46, A6).
 *
 * The POS is an OFFLINE-FIRST register for the physical counter / outlet:
 * a shift opens with a cash float, sales are recorded locally while the
 * network is down (queued, with a client-generated idempotency key per sale),
 * and the shift closes with a cash count that is reconciled against the
 * expected drawer total. All money is integer poisha.
 *
 * Receipts are NOT a new format: a POS sale produces receipt data in the
 * exact PrintData shape from src/orders/print (document "invoice",
 * format THERMAL_80 / THERMAL_58) so the same print pipeline renders it.
 */
import { z } from "zod";
import type { PrintData } from "../orders/print";

export interface PosRegister {
  id: string;
  /** Outlet / counter name, e.g. "Dhanmondi Outlet — Counter 1". */
  name: string;
  warehouseId?: string;
  isActive: boolean;
}

export type ShiftStatus = "OPEN" | "CLOSED";

export interface PosShift {
  id: string;
  registerId: string;
  openedBy: string;
  openedAt: string;
  /** Cash float put in the drawer at open, poisha. */
  openingFloatPoisha: number;
  status: ShiftStatus;
  closedBy?: string;
  closedAt?: string;
  /** Cashier's counted cash at close, poisha. Set only on close. */
  countedCashPoisha?: number;
  /** Expected drawer cash at close (computed in register.ts), poisha. */
  expectedCashPoisha?: number;
  /** counted - expected, poisha. Negative = short, positive = over. Never hidden. */
  variancePoisha?: number;
}

export type PosPaymentMethod = "CASH" | "BKASH" | "NAGAD" | "CARD";

export interface PosSaleLine {
  variantId: string;
  sku: string;
  productName: string;
  quantity: number;
  unitPricePoisha: number;
}

export type PosSaleStatus = "QUEUED_OFFLINE" | "SYNCED" | "VOIDED";

export interface PosSale {
  id: string;
  shiftId: string;
  registerId: string;
  /** Client-generated UUID per sale attempt — the server dedupes on this. */
  idempotencyKey: string;
  lines: PosSaleLine[];
  discountPoisha: number;
  totalPoisha: number;
  paymentMethod: PosPaymentMethod;
  /** Cash tendered for CASH sales; change is derived, never stored as float. */
  tenderedPoisha?: number;
  status: PosSaleStatus;
  createdAt: string;
  /** True until the sale has been pushed to the server orders API. */
  offline: boolean;
}

/**
 * A barcode/QR scan payload as the scanner (camera or USB HID) delivers it.
 * The register resolves it against the catalog by SKU first, then barcode.
 */
export const scanPayloadSchema = z.object({
  code: z.string().min(1).max(128),
  symbology: z.enum(["EAN13", "CODE128", "QR", "MANUAL"]).default("CODE128"),
  scannedAt: z.string().datetime(),
});

export type ScanPayload = z.infer<typeof scanPayloadSchema>;

export interface ScanResolution {
  matched: boolean;
  variantId?: string;
  sku?: string;
  productName?: string;
  unitPricePoisha?: number;
}

/** Receipt = the shared PrintData shape, nothing POS-specific. */
export type PosReceiptData = PrintData;

export const openShiftSchema = z.object({
  registerId: z.string().min(1),
  openingFloatPoisha: z.number().int().nonnegative(),
});

export const closeShiftSchema = z.object({
  countedCashPoisha: z.number().int().nonnegative(),
  /** A variance at close requires a note — a shortage is never silently closed. */
  note: z.string().max(500).optional(),
});

export const posSaleLineSchema = z.object({
  variantId: z.string().min(1),
  sku: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPricePoisha: z.number().int().nonnegative(),
});

export const createPosSaleSchema = z.object({
  shiftId: z.string().min(1),
  registerId: z.string().min(1),
  idempotencyKey: z.string().uuid(),
  lines: z.array(posSaleLineSchema).min(1),
  discountPoisha: z.number().int().nonnegative().default(0),
  paymentMethod: z.enum(["CASH", "BKASH", "NAGAD", "CARD"]),
  tenderedPoisha: z.number().int().nonnegative().optional(),
  offline: z.boolean().default(true),
});

export type CreatePosSaleInput = z.infer<typeof createPosSaleSchema>;
