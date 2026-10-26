/**
 * Shared guards for /api/v1/admin/team routes (ADV-27 remainder).
 *
 * - requireTeamSession: ANY signed-in active staff member — used by
 *   the self-service attendance endpoints (check-in/out, my state).
 *   Mirrors the admin-nav convention that the dashboard home is for
 *   "any signed-in staff member".
 * - requireTeamPermission: session + one RBAC permission, via the
 *   shared admin-auth guard. Reads use staff.view (the staff
 *   directory read permission); writes use staff.manage (the same
 *   permission that invites/suspends staff and is held by Owner +
 *   Manager in the seeded roles).
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken, type SessionUser } from "@/lib/auth";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import type { PermissionKey } from "@/lib/rbac";
import { TeamError } from "./docs";

export type TeamGuardOutcome =
  | { ok: true; user: SessionUser }
  | { ok: false; response: NextResponse };

function errorResponse(httpStatus: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status: httpStatus });
}

export async function requireTeamSession(): Promise<TeamGuardOutcome> {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return { ok: false, response: errorResponse(401, "UNAUTHENTICATED", "Login required.") };
  }
  const session = await validateSessionToken(token);
  if (!session) {
    return { ok: false, response: errorResponse(401, "UNAUTHENTICATED", "Session expired. Login again.") };
  }
  return { ok: true, user: session.user };
}

export async function requireTeamPermission(permission: PermissionKey): Promise<TeamGuardOutcome> {
  const guard = await requireAdminPermission(permission);
  if (!guard.ok) {
    return { ok: false, response: errorResponse(guard.httpStatus, guard.code, guard.message) };
  }
  return { ok: true, user: guard.user };
}

/** Map a thrown error to the standard { error } response shape. */
export function teamErrorResponse(error: unknown): NextResponse {
  if (error instanceof TeamError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      { status: error.httpStatus },
    );
  }
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "অপ্রত্যাশিত ত্রুটি — আবার চেষ্টা করুন।" } },
    { status: 500 },
  );
}
