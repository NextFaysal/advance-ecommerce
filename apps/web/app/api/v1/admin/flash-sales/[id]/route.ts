import { NextResponse } from "next/server";
import { flashSaleActiveSchema, updateFlashSaleSchema } from "@/marketing/flash-sale-server";
import {
  deleteFlashSaleDb,
  getFlashSaleDb,
  setFlashSaleActiveDb,
  updateFlashSaleDb,
} from "@/marketing/repository";
import { guardError, requireAdmin } from "@/reports/guard";

// Flash sale detail — GET / PUT (full replace, items included) /
// PATCH ({ isActive } toggle) / DELETE (soft delete via deletedAt).
// RBAC: marketing.campaign — see the collection route header for why.

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

function notFound(): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Flash sale not found." } },
    { status: 404 },
  );
}

function dbNotReady(): NextResponse {
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Flash sales need a working database." } },
    { status: 503 },
  );
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const flashSale = await getFlashSaleDb(params.id);
    if (!flashSale) return notFound();
    return NextResponse.json({ data: { flashSale }, meta: { persistence: "database" } });
  } catch {
    return dbNotReady();
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = updateFlashSaleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid flash sale.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const flashSale = await updateFlashSaleDb(params.id, parsed.data);
    if (!flashSale) return notFound();
    return NextResponse.json({ data: { flashSale }, meta: { persistence: "database" } });
  } catch (e) {
    return writeError(e);
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = flashSaleActiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid flash sale toggle.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const flashSale = await setFlashSaleActiveDb(params.id, parsed.data.isActive);
    if (!flashSale) return notFound();
    return NextResponse.json({ data: { flashSale }, meta: { persistence: "database" } });
  } catch {
    return dbNotReady();
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("marketing.campaign");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const ok = await deleteFlashSaleDb(params.id);
    return NextResponse.json(
      { data: { deleted: ok }, meta: { persistence: "database", softDelete: true } },
      { status: ok ? 200 : 404 },
    );
  } catch {
    return dbNotReady();
  }
}
