import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  TaxonomyError,
  categoryCreateSchema,
  createCategoryAdmin,
  listCategoriesAdmin,
} from "@/catalog/taxonomy-admin";

// Categories admin (Wave P2a) — RBAC reuses the products keys: there is
// no catalog.taxonomy permission in the seed, and category management
// is part of the products surface (view=products.view, create=
// products.create, edit=products.edit, delete=products.delete).
// Data: src/catalog/taxonomy-admin.ts (Prisma, soft-delete semantics).

function taxonomyFailure(e: unknown): NextResponse {
  if (e instanceof TaxonomyError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Taxonomy needs a working database." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("products.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const categories = await listCategoriesAdmin();
    return NextResponse.json({ data: { categories }, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("products.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = categoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid category.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const category = await createCategoryAdmin(parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "categories.create",
      entityType: "Category",
      entityId: category.id,
      afterJson: { slug: category.slug, nameEn: category.nameEn, parentId: category.parentId },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { category }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    return taxonomyFailure(e);
  }
}
