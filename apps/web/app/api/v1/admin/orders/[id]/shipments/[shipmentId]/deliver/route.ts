/**
 * Mark one split booking delivered — POST
 * /api/v1/admin/orders/[id]/shipments/[shipmentId]/deliver (doc 17, O5)
 *
 * Staff-confirmed completion of a split parcel (e.g. the customer or
 * the rider confirmed receipt over the phone). The partial-delivery
 * rule lives in src/shipments/split-shipments.ts: the order is only
 * delivered once every line is covered by a DELIVERED booking;
 * otherwise the order stays SHIPPED with a timeline note.
 * (The courier-webhook path is O5-1's route; this endpoint exists so
 * split parcels have a completion surface of their own.)
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { completeSplitShipmentDelivery } from "@/shipments/split-shipments";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
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

const bodySchema = z.object({ codCollectedPoisha: z.number().int().nonnegative().optional() });

export async function POST(
  req: Request,
  { params }: { params: { id: string; shipmentId: string } },
) {
  const auth = await requireAdmin("shipments.book");
  if ("error" in auth) return auth.error;
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return err("INVALID_INPUT", "Invalid deliver input.", 400);
  const shipment = await prisma.shipment.findFirst({
    where: { id: params.shipmentId, deletedAt: null },
    select: { id: true, orderId: true },
  });
  if (!shipment || shipment.orderId !== params.id) {
    return err("SHIPMENT_NOT_FOUND", "Shipment not found for this order. / এই অর্ডারে শিপমেন্টটি পাওয়া যায়নি।", 404);
  }
  const result = await completeSplitShipmentDelivery(params.shipmentId, parsed.data);
  if (!result.ok) return err(result.code, result.error, result.code === "SHIPMENT_NOT_FOUND" ? 404 : 400);
  return NextResponse.json({ data: result.value, meta: { sandbox: true } });
}
