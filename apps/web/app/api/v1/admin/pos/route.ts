import { NextResponse } from "next/server";
import { demoPosFlags } from "@/pos/flags";
import { expectedCashPoisha, openShiftForRegister } from "@/pos/register";
import { DEMO_REGISTERS, demoSales, demoShifts } from "@/pos/service";
import { posGuardError, requirePosAdmin } from "./guard";
import { posCatalog } from "./catalog";

// POS register state — Agent 38 (module built by Agent 14 in src/pos).
// Paid add-on: module.pos is checked first by the guard
// (403 FEATURE_LOCKED when off). Persistence is the src/pos in-memory
// demo store, labelled in meta. POS sales recorded here are demo-store
// records only — they do NOT create real Orders (see the sale route).

export async function GET() {
  const guard = await requirePosAdmin("pos.view");
  if (!guard.ok) return NextResponse.json(posGuardError(guard), { status: guard.status });

  const registers = DEMO_REGISTERS.map((register) => {
    const currentShift = openShiftForRegister(demoShifts, register.id);
    const shiftSales = currentShift ? demoSales.filter((s) => s.shiftId === currentShift.id) : [];
    return {
      register,
      currentShift,
      expectedCashPoisha: currentShift ? expectedCashPoisha(currentShift, demoSales) : null,
      shiftSalesCount: shiftSales.length,
      shiftSalesTotalPoisha: shiftSales
        .filter((s) => s.status !== "VOIDED")
        .reduce((sum, s) => sum + s.totalPoisha, 0),
    };
  });

  return NextResponse.json({
    data: {
      flags: demoPosFlags.list(),
      registers,
      shifts: demoShifts,
      sales: demoSales,
      catalog: posCatalog(),
    },
    meta: { persistence: "in-memory-demo", source: "TEMPORARY_DEMO_STORE", catalogSource: "TEMPORARY_MOCK" },
  });
}
