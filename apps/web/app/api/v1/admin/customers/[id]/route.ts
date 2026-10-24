/**
 * Admin customer detail — /api/v1/admin/customers/[id]
 * GET: customer profile + their mock orders. Phone masked by default;
 * full phone only with customers.view_full_phone, audited via logPhoneAccess.
 * TEMPORARY MOCK until Customer/Order tables land (Agent 6).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission, phoneForViewer, requirePermission, RbacError } from "@/lib/rbac";
import { logPhoneAccess } from "@/lib/audit";
import { MOCK_CUSTOMERS, MOCK_ORDERS } from "@/orders/mock";

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

  const customer = MOCK_CUSTOMERS.find((c) => c.id === params.id);
  if (!customer) return err("NOT_FOUND", "Customer not found.", 404);

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
  const orders = MOCK_ORDERS.filter((o) => o.customerPhone === customer.phone).map((o) => ({
    ...o,
    customerPhone: phoneForViewer(o.customerPhone, session.user.permissions) ?? "",
  }));
  return NextResponse.json({
    data: {
      customer: { ...customer, phone: phoneForViewer(customer.phone, session.user.permissions) ?? "" },
      orders,
    },
    meta: { db: "NOT_WIRED", source: "TEMPORARY_MOCK", phonesMasked: !canSeeFullPhone },
  });
}
