/**
 * Admin download grant lookup — /api/v1/admin/downloads/lookup
 * (doc 18, F3). GET ?orderNo=<order number or order id> → the
 * order's download grants with computed statuses, so staff can
 * answer "my download doesn't work" without opening the database.
 * Reads guard on products.view.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getOrderDownloadGrants } from "@/catalog/download-reissue";

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

export async function GET(req: Request) {
  const auth = await requireAdmin("products.view");
  if ("error" in auth) return auth.error;
  const orderRef = (new URL(req.url).searchParams.get("orderNo") ?? "").trim();
  if (orderRef === "") {
    return err("INVALID_INPUT", "orderNo query parameter is required. / অর্ডার নম্বর দিন।", 400);
  }
  const out = await getOrderDownloadGrants(orderRef);
  if (!out.ok) return err(out.code, out.error, out.code === "ORDER_NOT_FOUND" ? 404 : 400);
  return NextResponse.json({ data: out.value, meta: { db: "PRISMA", source: "DATABASE" } });
}
