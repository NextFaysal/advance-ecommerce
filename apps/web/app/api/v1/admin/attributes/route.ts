import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  AttributeError,
  attributeCreateSchema,
  createAttributeSetAdmin,
  listAttributeSetsAdmin,
} from "@/catalog/attributes-admin";

// Attribute sets admin (Wave 13-2) — the ProductAttribute library.
// RBAC reuses the products keys, same as categories/brands (no
// separate attribute permission exists in the seed): view=
// products.view, create=products.create, edit=products.edit,
// delete=products.delete. Data: src/catalog/attributes-admin.ts.

function attributeFailure(e: unknown): NextResponse {
  if (e instanceof AttributeError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Attribute sets need a working database." } },
    { status: 503 },
  );
}

export async function GET() {
  const guard = await requireAdmin("products.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const attributes = await listAttributeSetsAdmin();
    return NextResponse.json({ data: { attributes }, meta: { persistence: "database" } });
  } catch (e) {
    return attributeFailure(e);
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("products.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = attributeCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid attribute set.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const attribute = await createAttributeSetAdmin(parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "attributes.create",
      entityType: "ProductAttribute",
      entityId: attribute.id,
      afterJson: { key: attribute.key, labelEn: attribute.labelEn, values: attribute.values },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { attribute }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    return attributeFailure(e);
  }
}
