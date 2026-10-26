import { NextResponse } from "next/server";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { verifyAndStoreRegistration } from "@/security/webauthn";
import { writeAudit } from "@/lib/audit";
import { requireSelfSession, selfGuardError } from "../../../2fa/guard";

// POST /api/v1/admin/auth/passkey/register/verify — step 2 of staff
// passkey registration. Body: { response, deviceLabel } where
// response is the RegistrationResponseJSON produced by the browser's
// navigator.credentials.create() (via @simplewebauthn/browser). The
// structural check below is deliberately light — the cryptographic
// verification in verifyAndStoreRegistration is the real gate, and it
// fails closed on anything malformed. Success is audited as
// auth.passkey.register; the credential id/public key are public
// material, so they may appear in the audit snapshot (no secret is
// ever involved in a passkey ceremony).
const bodySchema = z.object({
  response: z
    .object({ id: z.string().min(1), type: z.literal("public-key") })
    .passthrough(),
  deviceLabel: z.string().trim().min(1).max(80),
});

export async function POST(req: Request) {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Passkey registration failed. Please try again." } },
      { status: 400 },
    );
  }
  const result = await verifyAndStoreRegistration({
    userId: guard.userId,
    response: parsed.data.response as unknown as RegistrationResponseJSON,
    deviceLabel: parsed.data.deviceLabel,
  });
  if (result.status === "not_configured") {
    return NextResponse.json(
      { error: { code: "PASSKEY_NOT_CONFIGURED", message: "Passkeys are not configured on this server." } },
      { status: 503 },
    );
  }
  if (result.status === "failed") {
    return NextResponse.json(
      { error: { code: "PASSKEY_VERIFICATION_FAILED", message: "Passkey registration failed. Please try again." } },
      { status: 401 },
    );
  }
  await writeAudit({
    actorId: guard.userId,
    action: "auth.passkey.register",
    entityType: "StaffWebAuthnCredential",
    entityId: result.credentialRowId,
    afterJson: { deviceLabel: parsed.data.deviceLabel, credentialId: result.credentialId },
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { status: "ok" } });
}

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
    { status: 405 },
  );
}
