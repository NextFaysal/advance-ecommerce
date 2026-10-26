/**
 * Route guard for the automation + fraud-rules admin routes — Agent 13.
 *
 * Order of checks (fail-closed at every step):
 *  1. Feature flag in the demo flag store (flags.ts). OFF -> 403
 *     FEATURE_LOCKED. Paid add-on modules never run because a route exists;
 *     they run because the client's flag is on.
 *  2. `admin_session` cookie present -> else 401.
 *  3. Session validated server-side via validateSessionToken (dynamic
 *     import, same fail-closed pattern as src/reports/guard.ts): if the
 *     generated Prisma client is unavailable the route returns 503
 *     PRISMA_PENDING instead of running unauthenticated.
 *  4. Permission string present in the session's permission list.
 *
 * `automation.view`, `automation.manage`, `fraud.view` and `fraud.manage`
 * are registered in PERMISSIONS (src/lib/rbac.ts) and in the seed catalogue
 * so roles can be granted them. The guard checks the DB-backed session list
 * at runtime.
 */
import { cookies } from "next/headers";
import { demoFeatureFlags, type FeatureFlagKey } from "./flags";

export type FeatureGuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requireFeatureAdmin(
  flagKey: FeatureFlagKey,
  permission: string,
): Promise<FeatureGuardResult> {
  if (!demoFeatureFlags.isEnabled(flagKey)) {
    return {
      ok: false,
      status: 403,
      code: "FEATURE_LOCKED",
      message: `Module is locked: ${flagKey} is off. It is a paid add-on — enable the feature flag to use it.`,
    };
  }
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Admin login required." };
  }
  try {
    const auth = await import("../lib/auth");
    const session = await auth.validateSessionToken(token);
    if (!session) {
      return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Session expired. Login again." };
    }
    if (!session.user.permissions.includes(permission)) {
      return { ok: false, status: 403, code: "FORBIDDEN", message: `Missing permission: ${permission}` };
    }
    return { ok: true, userId: session.user.id, permissions: session.user.permissions };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "PRISMA_PENDING",
      message: "Session validation pending Prisma generate. Route is fail-closed until then.",
    };
  }
}

export function featureGuardError(result: Extract<FeatureGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
