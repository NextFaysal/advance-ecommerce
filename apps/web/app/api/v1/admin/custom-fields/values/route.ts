import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import { guardError, requireAdmin, type GuardResult } from "@/reports/guard";
import type { PermissionKey } from "@/lib/rbac";
import {
  definitionsForEntity,
  getEntityCustomFieldValues,
  isWiredCustomFieldEntity,
  loadCustomFieldDefinitions,
  validateAndSetEntityCustomFieldValues,
  type WiredCustomFieldEntity,
} from "@/extensibility/custom-fields-store";
import { validationError } from "@/webhooks/admin-http";
import { recordDemoAudit } from "../../audit-log/store";

// Custom-field VALUES for one entity — admin (ADV-26 wiring,
// doc 23 wave 53). One route for all three wired entities; the
// guard follows the entity's own permissions:
//   read  → products.view / customers.view / orders.view
//   write → products.edit / customers.edit / orders.edit
// GET returns the entity's definitions WITH the stored values so
// the admin panel renders the form from a single fetch. PUT runs
// the payload through the extensibility engine's validator
// (unknown keys / missing required / type errors) and surfaces the
// engine's error shape verbatim in error.details; nothing is
// written on failure. Reason-required + audited like every
// machine-doc write in this codebase.

const VIEW_PERMISSION: Record<WiredCustomFieldEntity, PermissionKey> = {
  product: "products.view",
  customer: "customers.view",
  order: "orders.view",
};
const EDIT_PERMISSION: Record<WiredCustomFieldEntity, PermissionKey> = {
  product: "products.edit",
  customer: "customers.edit",
  order: "orders.edit",
};
const ENTITY_LABEL: Record<WiredCustomFieldEntity, string> = {
  product: "Product",
  customer: "Customer",
  order: "Order",
};

function parseEntity(raw: string | null): WiredCustomFieldEntity | null {
  return raw && isWiredCustomFieldEntity(raw) ? raw : null;
}

async function entityExists(entity: WiredCustomFieldEntity, entityId: string): Promise<boolean> {
  if (entity === "product") {
    return (await prisma.product.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } })) !== null;
  }
  if (entity === "customer") {
    return (await prisma.customer.findFirst({ where: { id: entityId, deletedAt: null }, select: { id: true } })) !== null;
  }
  return (await prisma.order.findUnique({ where: { id: entityId }, select: { id: true } })) !== null;
}

function guardFailed(guard: Extract<GuardResult, { ok: false }>) {
  return NextResponse.json(guardError(guard), { status: guard.status });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entity = parseEntity(url.searchParams.get("entity"));
  const entityId = url.searchParams.get("entityId") ?? "";
  if (!entity || entityId === "") {
    return validationError(["entity: must be product, customer or order; entityId is required."]);
  }
  const guard = await requireAdmin(VIEW_PERMISSION[entity]);
  if (!guard.ok) return guardFailed(guard);
  if (!(await entityExists(entity, entityId))) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `${ENTITY_LABEL[entity]} not found.` } },
      { status: 404 },
    );
  }
  const definitions = definitionsForEntity(await loadCustomFieldDefinitions(), entity);
  const values = (await getEntityCustomFieldValues(entity, entityId)) ?? {};
  return NextResponse.json({
    data: { entity, entityId, definitions, values },
    meta: { persistence: "setting-doc" },
  });
}

const putSchema = z.object({
  entity: z.string().min(1),
  entityId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  reason: z.string().trim().min(1).max(500),
});

export async function PUT(req: Request) {
  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const entity = parseEntity(parsed.data.entity);
  if (!entity) {
    return validationError(["entity: must be product, customer or order."]);
  }
  const guard = await requireAdmin(EDIT_PERMISSION[entity]);
  if (!guard.ok) return guardFailed(guard);
  if (!(await entityExists(entity, parsed.data.entityId))) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: `${ENTITY_LABEL[entity]} not found.` } },
      { status: 404 },
    );
  }

  const result = await validateAndSetEntityCustomFieldValues(
    entity,
    parsed.data.entityId,
    parsed.data.values,
    guard.userId,
  );
  if (!result.ok) {
    // The engine's error shape, verbatim: [{ key, message }].
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Custom field values failed validation.",
          details: result.errors,
        },
      },
      { status: 400 },
    );
  }
  await recordDemoAudit({
    actorId: guard.userId,
    action: "custom_fields.values.update",
    entityType: ENTITY_LABEL[entity],
    entityId: parsed.data.entityId,
    reason: parsed.data.reason,
    afterJson: { customFields: result.values },
  });
  return NextResponse.json({
    data: { entity, entityId: parsed.data.entityId, values: result.values },
    meta: { persistence: "setting-doc" },
  });
}
