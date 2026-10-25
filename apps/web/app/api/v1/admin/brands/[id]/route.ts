import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  TaxonomyError,
  brandUpdateSchema,
  deleteBrandAdmin,
  getBrandAdmin,
  updateBrandAdmin,
} from "@/catalog/taxonomy-admin";

// Brand by id (Wave P2a) — PATCH products.edit, DELETE
// products.delete. DELETE is a soft delete (deletedAt) and is REFUSED
// (409 BRAND_HAS_PRODUCTS) while products still reference the brand;
// Brand has no isActive column, so reassignment is the only path.

function taxonomyFailure(e: unknown): NextResponse {
  if (e instanceof TaxonomyError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Taxonomy needs a working database." } },
    { status: 503 },
  );
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("products.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = brandUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid brand update.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const before = await getBrandAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Brand not found." } }, { status: 404 });
    }
    const brand = await updateBrandAdmin(params.id, parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "brands.update",
      entityType: "Brand",
      entityId: brand.id,
      beforeJson: { slug: before.slug, name: before.name, logoUrl: before.logoUrl },
      afterJson: { slug: brand.slug, name: brand.name, logoUrl: brand.logoUrl },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { brand }, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("products.delete");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const before = await getBrandAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Brand not found." } }, { status: 404 });
    }
    const result = await deleteBrandAdmin(params.id);
    await writeAudit({
      actorId: guard.userId,
      action: "brands.delete",
      entityType: "Brand",
      entityId: params.id,
      beforeJson: { slug: before.slug, name: before.name, productCount: before.productCount },
      afterJson: { retired: true },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}
