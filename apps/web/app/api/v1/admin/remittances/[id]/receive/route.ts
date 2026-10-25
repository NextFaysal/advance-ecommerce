/**
 * Record a remittance receipt — POST /api/v1/admin/remittances/[id]/receive
 * (payments.remit; audited in the service). Body: { receivedPoisha,
 * feePoisha, note? } — the service computes and stores the variance
 * (expected − received − fee) and flips OPEN → RECEIVED.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { receiveRemittance, type RemittanceResult } from "@/orders/remittance";

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin("payments.remit");
  if ("error" in auth) return auth.error;
  let body: { receivedPoisha?: unknown; feePoisha?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("INVALID_INPUT", "JSON body required.", 400);
  }
  if (typeof body.receivedPoisha !== "number" || typeof body.feePoisha !== "number") {
    return err("INVALID_INPUT", "receivedPoisha and feePoisha (poisha integers) are required.", 400);
  }
  const out = unwrap(
    await receiveRemittance(
      params.id,
      {
        receivedPoisha: body.receivedPoisha,
        feePoisha: body.feePoisha,
        note: typeof body.note === "string" ? body.note : undefined,
      },
      { id: auth.session.user.id },
    ),
  );
  if ("response" in out) return out.response;
  return NextResponse.json({ data: out.value });
}
