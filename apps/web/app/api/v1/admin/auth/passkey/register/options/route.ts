import { NextResponse } from "next/server";
import { buildRegistrationOptions } from "@/security/webauthn";
import { requireSelfSession, selfGuardError } from "../../../2fa/guard";

// POST /api/v1/admin/auth/passkey/register/options — step 1 of staff
// passkey registration (doc 23 wave 55). Requires the caller's own
// authenticated admin session (same guard as the TOTP enrolment
// routes): passkeys are only ever added from inside a signed-in
// session, never from the login page. The returned options include
// the one-time challenge, which the server parks in Redis (5 min)
// for the verify step.
export async function POST() {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const result = await buildRegistrationOptions(guard.userId);
  if (result.status === "not_configured") {
    return NextResponse.json(
      { error: { code: "PASSKEY_NOT_CONFIGURED", message: "Passkeys are not configured on this server." } },
      { status: 503 },
    );
  }
  if (result.status === "no_user") {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: { options: result.options } });
}

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
    { status: 405 },
  );
}
