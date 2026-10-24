/**
 * Admin customer detail — /api/v1/admin/customers/[id]
 * GET: customer profile + their orders. Phone masked by default;
 * full phone only with customers.view_full_phone, audited via logPhoneAccess.
 * DB-BACKED via src/orders/repository.getCustomerWithOrders.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission, phoneForViewer, requirePermission, RbacError } from "@/lib/rbac";
import { logPhoneAccess } from "@/lib/audit";
import { getCustomerWithOrders } from "@/orders/repository";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return err("UNAUTHENTICATED", "Admin login required.", 401);
  let session: Awaited<ReturnType<typeof validateSessionToken>> = null;
  try {
    session = await validateSessionToken(token);
  } catch {
    return err("DB_NOT_READY", "Session check needs a working database (Prisma generate + DB connection).", 503);
  }
  if (!session) return err("UNAUTHENTICATED", "Session expired or revoked.", 401);
  try {
    requirePermission(session.user.permissions, "customers.view");
  } catch (e) {
    if (e instanceof RbacError) return err("FORBIDDEN", e.message, 403);
    throw e;
  }

  const detail = await getCustomerWithOrders(params.id);
  if (!detail) return err("NOT_FOUND", "Customer not found.", 404);
  const { customer } = detail;

  const canSeeFullPhone = hasPermission(session.user.permissions, "customers.view_full_phone");
  if (canSeeFullPhone) {
    await logPhoneAccess({
      actorId: session.user.id,
      customerId: customer.id,
      reason: "Admin customer detail view (full phone permission)",
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  }
  const orders = detail.orders.map((o) => ({
    ...o,
    customerPhone: phoneForViewer(o.customerPhone, session.user.permissions) ?? "",
  }));
  return NextResponse.json({
    data: {
      customer: { ...customer, phone: phoneForViewer(customer.phone, session.user.permissions) ?? "" },
      orders,
    },
    meta: { db: "PRISMA", source: "DATABASE", phonesMasked: !canSeeFullPhone },
  });
}
