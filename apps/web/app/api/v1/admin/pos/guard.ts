/**
 * Route guard for POS admin routes — Agent 38. Mirrors
 * app/api/v1/admin/vendors/guard.ts (which mirrors src/b2b/guard.ts):
 * flag first (403 FEATURE_LOCKED when module.pos is off), then
 * admin_session cookie (401), then server-side session validation — if
 * the generated Prisma client is unavailable, 503 PRISMA_PENDING rather
 * than running unauthenticated — then the permission string.
 *
 * The flag comes from the src/pos demo flag store (OFF by default),
 * exactly like src/pos/register.ts assertPosEnabled().
 *
 * Permissions are the DEDICATED POS pair (Agent 60): reads
 * (register state, scan) require `pos.view`; writes (shift open/close,
 * sale create) require `pos.manage`. POS no longer borrows orders.*
 * permissions — `pos.view` / `pos.manage` are in src/lib/rbac.ts
 * PERMISSIONS and the seed catalogue.
 */
import { cookies } from "next/headers";
import { demoPosFlags } from "@/pos/flags";

export type PosGuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requirePosAdmin(permission: string): Promise<PosGuardResult> {
  if (!demoPosFlags.isEnabled("module.pos")) {
    return {
      ok: false, status: 403, code: "FEATURE_LOCKED",
      message: "Module is locked: module.pos is off. It is a paid add-on — enable the feature flag to use it.",
    };
  }
  const token = cookies().get("admin_session")?.value;
  if (!token) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Admin login required." };
  try {
    const auth = await import("@/lib/auth");
    const session = await auth.validateSessionToken(token);
    if (!session) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Session expired. Login again." };
    if (!session.user.permissions.includes(permission)) {
      return { ok: false, status: 403, code: "FORBIDDEN", message: `Missing permission: ${permission}` };
    }
    return { ok: true, userId: session.user.id, permissions: session.user.permissions };
  } catch {
    return { ok: false, status: 503, code: "PRISMA_PENDING", message: "Session validation pending Prisma generate. Route is fail-closed until then." };
  }
}

export function posGuardError(result: Extract<PosGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
