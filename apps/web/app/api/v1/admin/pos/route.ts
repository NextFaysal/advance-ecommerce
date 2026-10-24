import { NextResponse } from "next/server";
import { demoPosFlags } from "@/pos/flags";
import { expectedCashPoisha, openShiftForRegister } from "@/pos/register";
import { listRegistersDb, listSalesDb, listShiftsDb } from "@/pos/store";
import { posGuardError, requirePosAdmin } from "./guard";
import { posCatalog } from "./catalog";

// POS register state — Agent 38 (module built by Agent 14 in src/pos).
// Paid add-on: module.pos is checked first by the guard
// (403 FEATURE_LOCKED when off). Persistence is the Prisma DB
// (src/pos/store.ts). POS sales recorded here are DB records only —
// they do NOT create real Orders (see the sale route).
// The product catalog is the REAL catalog DB (./catalog.ts).

export async function GET() {
  const guard = await requirePosAdmin("pos.view");
  if (!guard.ok) return NextResponse.json(posGuardError(guard), { status: guard.status });

  let catalog: Awaited<ReturnType<typeof posCatalog>>;
  try {
    catalog = await posCatalog();
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Catalog database is not available." } },
      { status: 503 },
    );
  }

  let registers: Awaited<ReturnType<typeof listRegistersDb>>;
  let shifts: Awaited<ReturnType<typeof listShiftsDb>>;
  let sales: Awaited<ReturnType<typeof listSalesDb>>;
  try {
    [registers, shifts, sales] = await Promise.all([
      listRegistersDb(),
      listShiftsDb(),
      listSalesDb(),
    ]);
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "POS database is not available." } },
      { status: 503 },
    );
  }

  const registerViews = registers.map((register) => {
    const currentShift = openShiftForRegister(shifts, register.id);
    const shiftSales = currentShift ? sales.filter((s) => s.shiftId === currentShift.id) : [];
    return {
      register,
      currentShift,
      expectedCashPoisha: currentShift ? expectedCashPoisha(currentShift, sales) : null,
      shiftSalesCount: shiftSales.length,
      shiftSalesTotalPoisha: shiftSales
        .filter((s) => s.status !== "VOIDED")
        .reduce((sum, s) => sum + s.totalPoisha, 0),
    };
  });

  return NextResponse.json({
    data: {
      flags: demoPosFlags.list(),
      registers: registerViews,
      shifts,
      sales,
      catalog,
    },
    meta: { persistence: "database", source: "PRISMA", catalogSource: "database" },
  });
}
