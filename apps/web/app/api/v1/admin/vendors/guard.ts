/**
 * Route guard for vendor admin routes — Agent 18. Mirrors src/b2b/guard.ts:
 * flag first (403 FEATURE_LOCKED when module.multi_vendor is off), then
 * admin_session cookie (401), then server-side session validation — if the
 * generated Prisma client is unavailable, 503 PRISMA_PENDING rather than
 * running unauthenticated — then the permission (vendors.view /
 * vendors.manage, both already in src/lib/rbac.ts PERMISSIONS).
 */
import { cookies } from "next/headers";
import { demoVendorFlags } from "@/vendors/flags";

export type VendorGuardResult =
  | { ok: true; userId: string; permissions: string[] }
  | { ok: false; status: number; code: string; message: string };

export async function requireVendorAdmin(permission: string): Promise<VendorGuardResult> {
  if (!demoVendorFlags.isEnabled("module.multi_vendor")) {
    return {
      ok: false, status: 403, code: "FEATURE_LOCKED",
      message: "Module is locked: module.multi_vendor is off. It is a paid add-on — enable the feature flag to use it.",
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

export function vendorGuardError(result: Extract<VendorGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
