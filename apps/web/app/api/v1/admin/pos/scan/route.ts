import { NextResponse } from "next/server";
import { resolveScan } from "@/pos/register";
import { scanPayloadSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";
import { posCatalog } from "../catalog";

// POS barcode / SKU lookup — Agent 38, on src/pos/register.ts
// resolveScan() (SKU first). The catalog is the REAL catalog DB
// (../catalog.ts, ACTIVE products) — labelled in meta. An unmatched
// code is a normal 200 with matched: false, so the register can fall
// back to manual entry.
export async function POST(req: Request) {
  const guard = await requirePosAdmin("pos.view");
  if (!guard.ok) return NextResponse.json(posGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = scanPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid scan payload.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let catalog: Awaited<ReturnType<typeof posCatalog>>;
  try {
    catalog = await posCatalog();
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Catalog database is not available." } },
      { status: 503 },
    );
  }
  const resolution = resolveScan(parsed.data, catalog);
  return NextResponse.json({
    data: { resolution },
    meta: { persistence: "none-pure-logic", catalogSource: "database" },
  });
}
