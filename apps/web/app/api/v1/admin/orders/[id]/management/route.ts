/**
 * Order management fields — /api/v1/admin/orders/[id]/management
 * (doc 17, O6): assignee, priority, tags, operational HOLD, notes.
 *
 * GET:   the management view, INCLUDING the held state (held /
 *        heldAt / heldReason) so any admin surface can show a hold
 *        loudly. Guard: orders.view.
 * PATCH: apply changes; every change is audited with before/after
 *        (orders.management). Guard: orders.edit.
 *
 * HOLD ENFORCEMENT IS DELIBERATELY UI-LEVEL ONLY: this route records
 * the hold; it does NOT block the status funnel, and
 * applyOrderTransition never consults heldAt. Staff see the hold in
 * the panel and act on it — funnel-level enforcement is a deliberate
 * non-goal of this batch.
 *
 * Field mapping: the API field `assignedToId` writes the Order
 * column `assigneeId` (handled in src/orders/management.ts).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  getOrderManagement,
  updateOrderManagement,
  type OrderManagementResult,
} from "@/orders/management";

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
  ASSIGNEE_NOT_FOUND: 400,
  REASON_REQUIRED: 400,
};

function unwrap<T>(result: OrderManagementResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("orders.view");
  if ("error" in auth) return auth.error;
  const out = unwrap(await getOrderManagement(params.id));
  if ("response" in out) return out.response;
  return NextResponse.json({
    data: out.value,
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}

const bodySchema = z.object({
  assignedToId: z.string().min(1).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  tags: z.array(z.string().max(60)).max(10).optional(),
  held: z.boolean().optional(),
  heldReason: z.string().max(500).optional(),
  note: z.string().min(1).max(4000).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
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
    await updateOrderManagement(params.id, parsed.data, {
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
