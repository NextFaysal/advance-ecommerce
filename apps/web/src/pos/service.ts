/**
 * POS demo registers/shifts/sales — FIXTURE ONLY. Agent 14.
 *
 * PERSISTENCE SWAP DONE: the production path is src/pos/store.ts
 * (Prisma tables PosRegister / PosShift / PosSale); all POS routes and
 * the admin page read/write through it. The arrays below remain as
 * labelled fixtures and are no longer read by any route/page. (Offline
 * sales sync to the orders API by idempotencyKey is still future work —
 * POS sales do not create Orders.)
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
