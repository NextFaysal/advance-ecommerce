import { NextResponse } from "next/server";
import { resolveScan } from "@/pos/register";
import { scanPayloadSchema } from "@/pos/types";
import { posGuardError, requirePosAdmin } from "../guard";
import { posCatalog } from "../catalog";

// POS barcode / SKU lookup — Agent 38, on src/pos/register.ts
// resolveScan() (SKU first). The catalog is the TEMPORARY MOCK catalog
// (src/catalog/mock) until the catalog DB service lands — labelled in
// meta. An unmatched code is a normal 200 with matched: false, so the
// register can fall back to manual entry.
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
  const resolution = resolveScan(parsed.data, posCatalog());
  return NextResponse.json({
    data: { resolution },
    meta: { persistence: "none-pure-logic", catalogSource: "TEMPORARY_MOCK" },
  });
}
