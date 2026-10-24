/**
 * POS demo registers/shifts/sales — TEMPORARY in-memory, lost on restart.
 * In production these live in pos_registers / pos_shifts / pos_sales tables
 * and offline sales sync to the orders API by idempotencyKey. Agent 14.
 */
import type { PosRegister, PosSale, PosShift } from "./types";

export const DEMO_REGISTERS: PosRegister[] = [
  { id: "reg-1", name: "Main Outlet — Counter 1", isActive: true },
];

export const demoShifts: PosShift[] = [
  {
    id: "shift-1",
    registerId: "reg-1",
    openedBy: "staff-1",
    openedAt: "2026-10-24T03:00:00.000Z",
    openingFloatPoisha: 100_000, // ৳1,000 float
    status: "OPEN",
  },
];

export const demoSales: PosSale[] = [];
