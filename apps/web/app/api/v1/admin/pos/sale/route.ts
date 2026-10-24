import { NextResponse } from "next/server";
import { buildPosReceipt, createSale, saleTotal } from "@/pos/register";
import { demoSales, demoShifts } from "@/pos/service";
import { createPosSaleSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";

// POS sale — Agent 38, on src/pos/register.ts createSale().
// The sale is recorded in the src/pos in-memory demo store ONLY. It does
// NOT create a real Order: in production, offline POS sales sync to the
// orders API by idempotencyKey (the store is keyed on it here too — a
// replayed key returns the first sale, never a second record). Receipt
// data is the shared orders PrintData shape via buildPosReceipt().
export async function POST(req: Request) {
  const guard = await requirePosAdmin("pos.manage");
  if (!guard.ok) return NextResponse.json(posGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = createPosSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid POS sale.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const input = parsed.data;

  const duplicate = demoSales.find((s) => s.idempotencyKey === input.idempotencyKey);
  if (duplicate) {
    const total = saleTotal(duplicate);
    return NextResponse.json({
      data: {
        sale: duplicate,
        receipt: buildPosReceipt(duplicate),
        subtotalPoisha: total.ok ? total.subtotalPoisha : duplicate.totalPoisha + duplicate.discountPoisha,
        duplicate: true,
      },
      meta: { persistence: "in-memory-demo", createsOrder: false },
    });
  }

  const shift = demoShifts.find((s) => s.id === input.shiftId);
  if (!shift) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `Unknown shift: ${input.shiftId}` } },
      { status: 404 },
    );
  }
  if (shift.status !== "OPEN") {
    return NextResponse.json(
      { error: { code: "SHIFT_NOT_OPEN", message: `Shift ${shift.id} is ${shift.status}; sales need an open shift.` } },
      { status: 409 },
    );
  }
  if (shift.registerId !== input.registerId) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: `Shift ${shift.id} belongs to register ${shift.registerId}, not ${input.registerId}.` } },
      { status: 400 },
    );
  }

  const result = createSale(input, { id: `pos_${Date.now()}`, createdAt: new Date().toISOString() });
  if (!result.ok) {
    return NextResponse.json({ error: { code: "SALE_REJECTED", message: result.error } }, { status: 422 });
  }
  demoSales.push(result.sale);
  const totals = saleTotal(input);
  return NextResponse.json(
    {
      data: {
        sale: result.sale,
        receipt: buildPosReceipt(result.sale),
        subtotalPoisha: totals.ok ? totals.subtotalPoisha : result.sale.totalPoisha + result.sale.discountPoisha,
        duplicate: false,
      },
      meta: {
        persistence: "in-memory-demo",
        createsOrder: false,
        note: "Demo-store record only — no real Order is created. Production: offline sales sync to the orders API by idempotencyKey.",
      },
    },
    { status: 201 },
  );
}
