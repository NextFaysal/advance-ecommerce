import { NextResponse } from "next/server";
import { buildPosReceipt, saleTotal } from "@/pos/register";
import { createSaleDb } from "@/pos/store";
import { createPosSaleSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";

// POS sale — Agent 38, on src/pos/register.ts createSale() rules.
// The sale is recorded in the Prisma DB (src/pos/store.ts) ONLY. It does
// NOT create a real Order: in production, offline POS sales sync to the
// orders API by idempotencyKey (the store is keyed on it here too — a
// replayed key returns the first sale with duplicate: true, never a
// second record). Receipt data is the shared orders PrintData shape via
// buildPosReceipt().
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

  let result: Awaited<ReturnType<typeof createSaleDb>>;
  try {
    result = await createSaleDb(input);
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "POS database is not available." } },
      { status: 503 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.status },
    );
  }

  const sale = result.sale;
  const totals = saleTotal(sale);
  const subtotalPoisha = totals.ok ? totals.subtotalPoisha : sale.totalPoisha + sale.discountPoisha;
  if (result.duplicate) {
    return NextResponse.json({
      data: {
        sale,
        receipt: buildPosReceipt(sale),
        subtotalPoisha,
        duplicate: true,
      },
      meta: { persistence: "database", createsOrder: false },
    });
  }
  return NextResponse.json(
    {
      data: {
        sale,
        receipt: buildPosReceipt(sale),
        subtotalPoisha,
        duplicate: false,
      },
      meta: {
        persistence: "database",
        createsOrder: false,
        note: "Database record only — no real Order is created. Production: offline sales sync to the orders API by idempotencyKey.",
      },
    },
    { status: 201 },
  );
}
