/**
 * Route guard for rider admin routes — Agent 18. Same fail-closed pattern
 * as src/b2b/guard.ts: flag first (403 FEATURE_LOCKED), then admin_session
 * cookie (401), then server-side session validation — if the generated
 * Prisma client is unavailable, 503 PRISMA_PENDING rather than running
 * unauthenticated — then the permission string.
 *
 * NOTE for the RBAC/seed owner: `riders.view` / `riders.manage` are
 * enforced here as plain permission strings and still need adding to
 * PERMISSIONS in src/lib/rbac.ts and to the seed catalogue (same gap the
 * B2B slice flagged for `b2b.view` / `b2b.manage`).
 */
import { cookies } from "next/headers";
import { demoRiderFlags } from "./flags";

export type RiderGuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requireRiderAdmin(permission: string): Promise<RiderGuardResult> {
  if (!demoRiderFlags.isEnabled("module.rider")) {
    return {
      ok: false, status: 403, code: "FEATURE_LOCKED",
      message: "Module is locked: module.rider is off. It is a paid add-on — enable the feature flag to use it.",
    };
  }
  const token = cookies().get("admin_session")?.value;
  if (!token) return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Admin login required." };
  try {
    const auth = await import("../lib/auth");
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

export function riderGuardError(result: Extract<RiderGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
