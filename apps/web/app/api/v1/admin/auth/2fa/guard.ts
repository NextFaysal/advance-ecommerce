// Session-only guard for the self-service 2FA routes.
//
// Every staff member manages their OWN TOTP enrolment, so these routes
// require a valid admin session but no specific permission (unlike the
// permission-gated requireAdmin in src/reports/guard.ts). Fail-closed:
// no/expired session -> 401; session validation unavailable -> 503,
// mirroring the reports guard's contract.
import { cookies } from "next/headers";

export type SelfGuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: number; code: string; message: string };

export async function requireSelfSession(): Promise<SelfGuardResult> {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Admin login required." };
  }
  try {
    const auth = await import("@/lib/auth");
    const session = await auth.validateSessionToken(token);
    if (!session) {
      return { ok: false, status: 401, code: "UNAUTHENTICATED", message: "Session expired. Login again." };
    }
    return { ok: true, userId: session.user.id };
  } catch {
    return {
      ok: false,
      status: 503,
      code: "PRISMA_PENDING",
      message: "Session validation is unavailable. Route is fail-closed until then.",
    };
  }
}

export function selfGuardError(result: Extract<SelfGuardResult, { ok: false }>) {
  return { error: { code: result.code, message: result.message } };
}
