/**
 * Admin order shipments — /api/v1/admin/orders/[id]/shipments (doc 17, O5)
 * GET:  the order's bookings (whole-order + split) with per-line
 *       allocation/delivery coverage (shipments.view).
 * POST: create ONE split booking for exactly the requested lines
 *       (shipments.book) — src/shipments/split-shipments.ts owns the
 *       allocation validation; this route only authenticates,
 *       validates the body shape and maps errors.
 *
 * Bookings are sandbox bookings (SBX tracking ids, no real courier is
 * contacted), same as POST /api/v1/admin/shipments.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import {
  createSplitShipment,
  getOrderShipmentCoverage,
  type SplitResult,
} from "@/shipments/split-shipments";

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
  SHIPMENT_NOT_FOUND: 404,
  INVALID_INPUT: 400,
  INVALID_PROVIDER: 400,
  ITEM_NOT_IN_ORDER: 400,
  OVER_ALLOCATED: 409,
  ORDER_CLOSED: 409,
};

function unwrap<T>(result: SplitResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("shipments.view");
  if ("error" in auth) return auth.error;
  const coverage = await getOrderShipmentCoverage(params.id);
  if (!coverage) return err("ORDER_NOT_FOUND", "Order not found. / অর্ডার পাওয়া যায়নি।", 404);
  return NextResponse.json({ data: coverage, meta: { sandbox: true } });
}

const createSchema = z.object({
  items: z
    .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().positive() }))
    .min(1),
  provider: z.string().min(1).optional(),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("shipments.book");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "Invalid split shipment input.", 400, parsed.error.issues);
  }
  const out = unwrap(await createSplitShipment(params.id, parsed.data));
  if ("response" in out) return out.response;
  return NextResponse.json({ data: out.value, meta: { sandbox: true } }, { status: 201 });
}
