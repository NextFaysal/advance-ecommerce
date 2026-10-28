/**
 * Route guard for B2B admin routes — Agent 16. Same fail-closed pattern as
 * src/automation/guard.ts: flag first (403 FEATURE_LOCKED), then
 * admin_session cookie (401), then server-side session validation — if the
 * generated Prisma client is unavailable, 503 PRISMA_PENDING rather than
 * running unauthenticated — then the permission string.
 *
 * NOTE for the RBAC/seed owner: `b2b.view` / `b2b.manage` are enforced as
 * plain permission strings and still need adding to PERMISSIONS in
 * src/lib/rbac.ts and to the seed catalogue.
 */
import { cookies } from "next/headers";
import { ensureDbFeatureFlags } from "../lib/feature-flags-db";
import { demoB2bFlags } from "./flags";

export type B2bGuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requireB2bAdmin(permission: string): Promise<B2bGuardResult> {
  await ensureDbFeatureFlags().catch(() => {});
  if (!demoB2bFlags.isEnabled("module.b2b")) {
    return {
      ok: false, status: 403, code: "FEATURE_LOCKED",
      message: "Module is locked: module.b2b is off. It is a paid add-on — enable the feature flag to use it.",
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

export function b2bGuardError(result: Extract<B2bGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
