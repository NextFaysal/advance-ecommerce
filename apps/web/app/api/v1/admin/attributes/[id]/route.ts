import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  AttributeError,
  attributeUpdateSchema,
  deleteAttributeSetAdmin,
  getAttributeSetAdmin,
  updateAttributeSetAdmin,
} from "@/catalog/attributes-admin";

// Attribute set by id (Wave 13-2) — PATCH products.edit, DELETE
// products.delete. DELETE is a HARD delete: ProductAttribute has no
// deletedAt column, and products never reference a set by FK (variant
// attributes are self-contained JSON), so deleting a set cannot break
// existing products. See src/catalog/attributes-admin.ts.

function attributeFailure(e: unknown): NextResponse {
  if (e instanceof AttributeError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  return NextResponse.json(
    { error: { code: "DB_NOT_READY", message: "Attribute sets need a working database." } },
    { status: 503 },
  );
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("products.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = attributeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid attribute set update.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const before = await getAttributeSetAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Attribute set not found." } }, { status: 404 });
    }
    const attribute = await updateAttributeSetAdmin(params.id, parsed.data);
    await writeAudit({
      actorId: guard.userId,
      action: "attributes.update",
      entityType: "ProductAttribute",
      entityId: attribute.id,
      beforeJson: { key: before.key, labelEn: before.labelEn, values: before.values },
      afterJson: { key: attribute.key, labelEn: attribute.labelEn, values: attribute.values },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { attribute }, meta: { persistence: "database" } });
  } catch (e) {
    return attributeFailure(e);
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("products.delete");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const before = await getAttributeSetAdmin(params.id);
    if (!before) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Attribute set not found." } }, { status: 404 });
    }
    const result = await deleteAttributeSetAdmin(params.id);
    await writeAudit({
      actorId: guard.userId,
      action: "attributes.delete",
      entityType: "ProductAttribute",
      entityId: params.id,
      beforeJson: { key: before.key, labelEn: before.labelEn, values: before.values },
      afterJson: { deleted: true },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: result, meta: { persistence: "database" } });
  } catch (e) {
    return attributeFailure(e);
  }
}
