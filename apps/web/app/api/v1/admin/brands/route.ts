import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  TaxonomyError,
  brandCreateSchema,
  createBrandAdmin,
  listBrandsAdmin,
} from "@/catalog/taxonomy-admin";

// Brands admin (Wave P2a) — RBAC reuses the products keys (no separate
// brand permission exists in the seed): view=products.view, create=
// products.create, edit=products.edit, delete=products.delete.
// Data: src/catalog/taxonomy-admin.ts. NOTE: the Brand model has no
// description column (schema gap, no migration in this wave), so the
// API carries name/slug/logoUrl only.

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
    const brands = await listBrandsAdmin();
    return NextResponse.json({ data: { brands }, meta: { persistence: "database" } });
  } catch (e) {
    return taxonomyFailure(e);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("products.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = brandCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid brand.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const brand = await createBrandAdmin(parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "brands.create",
      entityType: "Brand",
      entityId: brand.id,
      afterJson: { slug: brand.slug, name: brand.name },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { brand }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    return taxonomyFailure(e);
  }
}
