import { NextResponse } from "next/server";
import { buildPosReceipt, saleTotal } from "@/pos/register";
import { createSaleDb } from "@/pos/store";
import { createPosSaleSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";

// POS sale — Agent 38, on src/pos/register.ts createSale() rules.
// This POST is also the OFFLINE SYNC endpoint: the register queues
// sales in the browser while offline (src/pos/offline-queue.ts) and
// flushes them here when the network returns (src/pos/sync.ts). The
// store is keyed on the sale's client idempotencyKey — a replayed key
// returns the first sale with duplicate: true, never a second record,
// so a flush retry after a lost response is always safe.
// The sale is recorded in the Prisma DB (src/pos/store.ts) ONLY. It
// does NOT create a real Order (createsOrder: false stays honest):
// an Order requires a customer phone + address that a walk-in sale
// does not have. As of doc 17 batch O1 the sync DOES move stock —
// same SALE_RESERVE seam as an order line, reported per sale in
// data.stock (shortfalls flagged, never hidden; a replayed key
// reports applied: "already" and moves nothing). Receipt data is
// the shared orders PrintData shape via buildPosReceipt().
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
        stock: result.stock,
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
        stock: result.stock,
      },
      meta: {
        persistence: "database",
        createsOrder: false,
        note: "Database record only — no real Order is created. This POST is the offline-sync endpoint: queued sales flush here by idempotencyKey. Stock was decremented for this sale (see data.stock).",
      },
    },
    { status: 201 },
  );
}
