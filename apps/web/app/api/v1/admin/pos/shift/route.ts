import { NextResponse } from "next/server";
import { z } from "zod";
import { closeShiftDb, openShiftDb } from "@/pos/store";
import { closeShiftSchema, openShiftSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";

// POS shift open / close — Agent 38, on src/pos/register.ts rules.
// Open: a register has at most ONE open shift (409 when one is open).
// Close: expected cash = float + CASH sales (register.ts). The counted
// cash is stored exactly as counted — a variance is REPORTED in the
// response (variancePoisha, hasVariance) and never adjusted away, and
// register.ts refuses a non-zero variance without an explanatory note.
// Persistence: Prisma DB via src/pos/store.ts.
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

  try {
    if (data.action === "open") {
      const result = await openShiftDb({
        registerId: data.registerId,
        openingFloatPoisha: data.openingFloatPoisha,
        openedBy: guard.userId,
      });
      if (!result.ok) {
        return NextResponse.json(
          { error: { code: result.code, message: result.message } },
          { status: result.status },
        );
      }
      return NextResponse.json(
        { data: { shift: result.shift }, meta: { persistence: "database" } },
        { status: 201 },
      );
    }

    // action === "close"
    const result = await closeShiftDb(data.shiftId, {
      countedCashPoisha: data.countedCashPoisha,
      closedBy: guard.userId,
      note: data.note,
    });
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: result.code, message: result.message } },
        { status: result.status },
      );
    }
    return NextResponse.json({
      data: {
        shift: result.shift,
        expectedCashPoisha: result.expectedCashPoisha,
        variancePoisha: result.variancePoisha,
        hasVariance: result.variancePoisha !== 0,
      },
      meta: { persistence: "database", varianceAdjusted: false },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "POS database is not available." } },
      { status: 503 },
    );
  }
}
