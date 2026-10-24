// Admin route guard for sandbox admin routes — Agent 9.
// Same pattern as the existing admin auth routes: the session token comes
// from the httpOnly admin_session cookie, is validated server-side via
// validateSessionToken(), and the required permission is enforced with
// requirePermission() from lib/rbac. Client-side hiding is never used as
// a boundary here. Returns a discriminated result so routes can respond
// with the standard { error: { code, message } } shape.
import { cookies } from "next/headers";
import { validateSessionToken, type SessionUser } from "../../lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "../../lib/rbac";

export type AdminGuardResult =
  | { ok: true; user: SessionUser }
  | { ok: false; httpStatus: 401 | 403; code: string; message: string };

export async function requireAdminPermission(permission: PermissionKey): Promise<AdminGuardResult> {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return { ok: false, httpStatus: 401, code: "UNAUTHENTICATED", message: "Login required." };
  }
  const session = await validateSessionToken(token);
  if (!session) {
    return { ok: false, httpStatus: 401, code: "UNAUTHENTICATED", message: "Session expired. Login again." };
  }
  try {
    requirePermission(session.user.permissions, permission);
  } catch (error) {
    if (error instanceof RbacError) {
      return { ok: false, httpStatus: 403, code: "FORBIDDEN", message: "You do not have permission for this action." };
    }
    throw error;
  }
  return { ok: true, user: session.user };
}
