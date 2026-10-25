/**
 * Admin COD remittance detail — GET /api/v1/admin/remittances/[id]
 * (payments.view): the batch plus its covered collections (order,
 * masked phone, collection date, expected per row).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { getRemittanceBatch, type RemittanceResult } from "@/orders/remittance";

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
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  NO_COLLECTIONS: 422,
  NOTE_REQUIRED: 422,
};

function unwrap<T>(result: RemittanceResult<T>): { value: T } | { response: NextResponse } {
  if (result.ok) return { value: result.value };
  return { response: err(result.code, result.error, ERROR_HTTP[result.code] ?? 400) };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("payments.view");
  if ("error" in auth) return auth.error;
  const out = unwrap(await getRemittanceBatch(params.id));
  if ("response" in out) return out.response;
  return NextResponse.json({ data: out.value });
}
