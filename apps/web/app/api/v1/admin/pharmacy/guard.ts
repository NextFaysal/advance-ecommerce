/**
 * Shared guard for the pharmacy admin routes (ADV-22): admin session
 * + permission, then the pack flag — a locked pack never runs open
 * (403 FEATURE_LOCKED). Lives outside route.ts files on purpose:
 * Next route modules may only export handlers + segment config.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError, type PermissionKey } from "@/lib/rbac";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isPackEnabled } from "@/business-modules/packs";

export function pharmacyErr(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function pharmacyGuard(permission: PermissionKey) {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: pharmacyErr("UNAUTHENTICATED", "Admin login required.", 401) };
  let session;
  try {
    session = await validateSessionToken(token);
    if (!session) return { error: pharmacyErr("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
  } catch (e) {
    if (e instanceof RbacError) return { error: pharmacyErr("FORBIDDEN", e.message, 403) };
    throw e;
  }
  await ensureDbFeatureFlags().catch(() => {});
  if (!isPackEnabled("pharmacy")) {
    return { error: pharmacyErr("FEATURE_LOCKED", "Pharmacy pack is not enabled for this store.", 403) };
  }
  return { session };
}
