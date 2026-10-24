import { NextResponse } from "next/server";
import { z } from "zod";
import { closeShift, expectedCashPoisha, openShiftForRegister } from "@/pos/register";
import { DEMO_REGISTERS, demoSales, demoShifts } from "@/pos/service";
import { closeShiftSchema, openShiftSchema, type PosShift } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";

// POS shift open / close — Agent 38, on src/pos/register.ts rules.
// Open: a register has at most ONE open shift (409 when one is open).
// Close: expected cash = float + CASH sales (register.ts). The counted
// cash is stored exactly as counted — a variance is REPORTED in the
// response (variancePoisha, hasVariance) and never adjusted away, and
// register.ts refuses a non-zero variance without an explanatory note.
const shiftActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open") }).merge(openShiftSchema),
  z.object({ action: z.literal("close"), shiftId: z.string().min(1) }).merge(closeShiftSchema),
]);

export async function POST(req: Request) {
  const guard = await requirePosAdmin("pos.manage");
  if (!guard.ok) return NextResponse.json(posGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = shiftActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid shift action.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const data = parsed.data;

  if (data.action === "open") {
    const register = DEMO_REGISTERS.find((r) => r.id === data.registerId);
    if (!register || !register.isActive) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: `Unknown or inactive register: ${data.registerId}` } },
        { status: 404 },
      );
    }
    const existing = openShiftForRegister(demoShifts, register.id);
    if (existing) {
      return NextResponse.json(
        { error: { code: "SHIFT_ALREADY_OPEN", message: `Register ${register.id} already has an open shift (${existing.id}). Close it first.` } },
        { status: 409 },
      );
    }
    const shift: PosShift = {
      id: `shift_${Date.now()}`,
      registerId: register.id,
      openedBy: guard.userId,
      openedAt: new Date().toISOString(),
      openingFloatPoisha: data.openingFloatPoisha,
      status: "OPEN",
    };
    demoShifts.push(shift);
    return NextResponse.json(
      { data: { shift }, meta: { persistence: "in-memory-demo" } },
      { status: 201 },
    );
  }

  // action === "close"
  const index = demoShifts.findIndex((s) => s.id === data.shiftId);
  if (index === -1) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown shift: ${data.shiftId}` } },
      { status: 404 },
    );
  }
  const current = demoShifts[index]!;
  const result = closeShift(current, demoSales, {
    countedCashPoisha: data.countedCashPoisha,
    closedBy: guard.userId,
    closedAt: new Date().toISOString(),
    note: data.note,
  });
  if (!result.ok) {
    return NextResponse.json({ error: { code: "SHIFT_CLOSE_REJECTED", message: result.error } }, { status: 422 });
  }
  demoShifts[index] = result.shift;
  const variancePoisha = result.shift.variancePoisha ?? 0;
  return NextResponse.json({
    data: {
      shift: result.shift,
      expectedCashPoisha: expectedCashPoisha(current, demoSales),
      variancePoisha,
      hasVariance: variancePoisha !== 0,
    },
    meta: { persistence: "in-memory-demo", varianceAdjusted: false },
  });
}
