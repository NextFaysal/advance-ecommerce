import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  TaxonomyError,
  categoryUpdateSchema,
  deleteCategoryAdmin,
  getCategoryAdmin,
  updateCategoryAdmin,
} from "@/catalog/taxonomy-admin";

// Category by id (Wave P2a) — PATCH products.edit, DELETE
// products.delete. DELETE is a soft delete (deletedAt) and is REFUSED
// (409) while the category still has products or sub-categories; retire
// it via PATCH isActive=false in that case. See taxonomy-admin.ts.

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
  const parsed = categoryUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid category update.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const before = await getCategoryAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Category not found." } }, { status: 404 });
    }
    const category = await updateCategoryAdmin(params.id, parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "categories.update",
      entityType: "Category",
      entityId: category.id,
      beforeJson: { slug: before.slug, nameEn: before.nameEn, parentId: before.parentId, isActive: before.isActive, sortOrder: before.sortOrder, seoTitleBn: before.seoTitleBn, seoTitleEn: before.seoTitleEn, seoDescriptionBn: before.seoDescriptionBn, seoDescriptionEn: before.seoDescriptionEn },
      afterJson: { slug: category.slug, nameEn: category.nameEn, parentId: category.parentId, isActive: category.isActive, sortOrder: category.sortOrder, seoTitleBn: category.seoTitleBn, seoTitleEn: category.seoTitleEn, seoDescriptionBn: category.seoDescriptionBn, seoDescriptionEn: category.seoDescriptionEn },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { category }, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("products.delete");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const before = await getCategoryAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Category not found." } }, { status: 404 });
    }
    const result = await deleteCategoryAdmin(params.id);
    await writeAudit({
      actorId: guard.userId,
      action: "categories.delete",
      entityType: "Category",
      entityId: params.id,
      beforeJson: { slug: before.slug, nameEn: before.nameEn, productCount: before.productCount, childCount: before.childCount },
      afterJson: { retired: true },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}
