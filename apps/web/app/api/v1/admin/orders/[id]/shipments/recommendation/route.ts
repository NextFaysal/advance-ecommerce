/**
 * Admin order booking recommendation — POST
 * /api/v1/admin/orders/[id]/shipments/recommendation (ADV-5, doc 22)
 *
 * Body: { items?: [{ orderItemId, quantity }] } — the lines staff are
 * about to book (omitted/empty = all of the order's lines). Returns
 * the assignment engine's ranked couriers over REAL shipment-history
 * stats (src/shipments/assignment-recommendation.ts), or an honest
 * "insufficient_data" status with no scores when no courier has any
 * delivery history yet. Read-only; guard shipments.view.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { getBookingRecommendation } from "@/shipments/assignment-recommendation";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

const bodySchema = z.object({
  items: z
    .array(z.object({ orderItemId: z.string().min(1), quantity: z.number().int().positive() }))
    .optional(),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  try {
    const session = await validateSessionToken(token);
    if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
    requirePermission(session.user.permissions, "shipments.view");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    return err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "Invalid recommendation input.", 400, parsed.error.issues);
  }
  const result = await getBookingRecommendation(params.id, parsed.data.items);
  if (!result.ok) {
    const status = result.code === "ORDER_NOT_FOUND" ? 404 : result.code === "ORDER_CLOSED" ? 409 : 400;
    return err(result.code, result.error, status);
  }
  return NextResponse.json({ data: result.value, meta: { sandbox: true } });
}
