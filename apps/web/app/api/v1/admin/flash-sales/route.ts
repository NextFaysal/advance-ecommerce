import { NextResponse } from "next/server";
import { createFlashSaleSchema } from "@/marketing/flash-sale";
import { createFlashSaleDb, listFlashSalesDb } from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// Flash sales — list + create. RBAC: marketing.campaign (the RBAC
// catalogue has no dedicated flash-sale key; a flash sale is a
// scheduled promotional campaign, and the Manager role that runs the
// marketing page holds this key — see src/lib/rbac.ts).
// DB-backed (FlashSale + FlashSaleItem tables, src/marketing/repository.ts):
// items key on variants; the repository derives productId from the
// variant and rejects a mismatched payload. Deletes are soft.

function writeError(e: unknown): NextResponse {
  if (e instanceof Error && e.message === "variant_not_found") {
    return NextResponse.json(
      { error: { code: "VARIANT_NOT_FOUND", message: "One or more variants do not exist." } },
      { status: 400 },
    );
  }
  if (e instanceof Error && e.message === "variant_product_mismatch") {
    return NextResponse.json(
      { error: { code: "VARIANT_PRODUCT_MISMATCH", message: "An item's productId does not match its variant's product." } },
      { status: 400 },
    );
  }
  if (typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002") {
    return NextResponse.json(
      { error: { code: "DUPLICATE_ITEM", message: "Each variant may appear only once per flash sale." } },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Flash sales need a working database." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const flashSales = await listFlashSalesDb();
    return NextResponse.json({ data: { flashSales }, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Flash sales need a working database." } },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = createFlashSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid flash sale.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const flashSale = await createFlashSaleDb(parsed.data);
    return NextResponse.json({ data: { flashSale }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    return writeError(e);
  }
}
