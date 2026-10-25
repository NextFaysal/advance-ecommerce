/**
 * Admin order returns — /api/v1/admin/orders/[id]/returns (doc 17, O7)
 * GET:  the order's returns + per-line returnable state (returns.view).
 * POST: create a return with source "admin" (returns.manage) — the
 *       service (src/orders/returns.ts) owns all validation: the
 *       order must be DELIVERED, quantities are capped at what has
 *       not already come back, and one open return per line.
 *
 * Creating a return moves NO money and NO stock: approval, the
 * receive-step restock decision and the completion refund all live on
 * /api/v1/admin/returns/[id] (POST transition).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  createReturn,
  getOrderReturnContext,
  getOrderReturnableLines,
  listReturnsForOrder,
  ReturnServiceError,
  type ReturnResult,
} from "@/orders/returns";

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
  RETURN_NOT_FOUND: 404,
  ORDER_NOT_DELIVERED: 409,
  INVALID_INPUT: 400,
  LINE_NOT_IN_ORDER: 400,
  INVALID_QUANTITY: 400,
  QUANTITY_EXCEEDED: 409,
  DUPLICATE_OPEN_RETURN: 409,
  REASON_REQUIRED: 400,
  INVALID_TRANSITION: 409,
  CONDITIONS_INCOMPLETE: 400,
  NO_REFUNDABLE_LINES: 409,
  REFUND_NOT_POSSIBLE: 409,
};

function unwrap<T>(result: ReturnResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("returns.view");
  if ("error" in auth) return auth.error;
  const list = unwrap(await listReturnsForOrder(params.id));
  if ("response" in list) return list.response;
  const lines = unwrap(await getOrderReturnableLines(params.id));
  if ("response" in lines) return lines.response;
  const context = await getOrderReturnContext(params.id);
  return NextResponse.json({
    data: { returns: list.value, lines: lines.value, orderStatus: context?.status ?? null },
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const createSchema = z.object({
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1),
        quantity: z.number().int().min(1),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .min(1),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("returns.manage");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "Invalid return input. / রিটার্নের তথ্য সঠিক নয়।", 400, parsed.error.issues);
  }
  try {
    const created = await createReturn({
      orderId: params.id,
      items: parsed.data.items,
      source: "admin",
      actorLabel: auth.session.user.id,
      customerNote: parsed.data.note,
    });
    const list = unwrap(await listReturnsForOrder(params.id));
    const view = "value" in list ? list.value.find((r) => r.id === created.returnId) ?? null : null;
    return NextResponse.json(
      { data: { returnId: created.returnId, status: created.status, view }, meta: { db: "PRISMA", source: "DATABASE" } },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ReturnServiceError) {
      return err(e.code, e.message, ERROR_HTTP[e.code] ?? 400);
    }
    throw e;
  }
}
