/**
 * Order line editing — /api/v1/admin/orders/[id]/edit (doc 17, O6).
 *
 * GET:  the editable view — lines WITH their order item ids, current
 *       totals, and whether the order is still editable (with a
 *       bilingual reason when it is not). Guard: orders.edit.
 * POST: apply line edits transactionally (orders.edit). The money is
 *       recomputed the way create computes it — engine shipping,
 *       coupon re-evaluation, VAT split; staff shipping overrides
 *       and free shipping are preserved per the rules in
 *       src/orders/edit.ts, which owns the whole operation.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  editOrderItems,
  getOrderEditView,
  type OrderEditResult,
} from "@/orders/edit";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

async function requireAdmin(permission: PermissionKey) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503) };
  }
}

const ERROR_HTTP: Record<string, number> = {
  ORDER_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  ITEM_NOT_FOUND: 400,
  VARIANT_NOT_FOUND: 400,
  EMPTY_ORDER: 400,
  ORDER_NOT_EDITABLE: 409,
  INSUFFICIENT_STOCK: 409,
  BUNDLE_LINE_NOT_EDITABLE: 409,
};

function unwrap<T>(result: OrderEditResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;
  const out = unwrap(await getOrderEditView(params.id));
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const bodySchema = z.object({
  setQuantities: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().min(0).max(999),
      }),
    )
    .max(100)
    .optional(),
  removeItemIds: z.array(z.string().min(1)).max(100).optional(),
  addItems: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .max(50)
    .optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.edit");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err(
      "VALIDATION_FAILED",
      `যাচাই ব্যর্থ হয়েছে / Validation failed: ${parsed.error.issues[0]?.message ?? "invalid body"}`,
      400,
    );
  }
  const out = unwrap(
    await editOrderItems(params.id, parsed.data, {
      id: auth.session.user.id,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    }),
  );
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
