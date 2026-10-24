// Admin route guard — Agent 10.
// Fail-closed: no admin_session cookie -> 401. Session validation needs the
// generated Prisma client (validateSessionToken); if that import/validation
// is unavailable, routes return 503 PRISMA_PENDING instead of running
// unauthenticated. When Prisma generate succeeds, this guard works as-is.
// Secrets: only booleans / permission strings ever leave this module.
import { cookies } from "next/headers";
import { requirePermission, type PermissionKey } from "../lib/rbac";

export type GuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requireAdmin(permission: PermissionKey): Promise<GuardResult> {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Admin login required." };
  try {
    const auth = await import("../lib/auth");
    const session = await auth.validateSessionToken(token);
    if (!session) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Session expired. Login again." };
    try {
      requirePermission(session.user.permissions, permission);
    } catch {
      return { ok: false, status: 403, code: "FORBIDDEN", message: `Missing permission: ${permission}` };
    }
    return { ok: true, userId: session.user.id, permissions: session.user.permissions };
  } catch {
    return { ok: false, status: 503, code: "PRISMA_PENDING", message: "Session validation pending Prisma generate. Route is fail-closed until then." };
  }
}
export function guardError(result: Extract<GuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
