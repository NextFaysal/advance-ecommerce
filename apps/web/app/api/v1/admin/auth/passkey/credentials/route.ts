import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { deletePasskey, listPasskeys } from "@/security/webauthn";
import { writeAudit } from "@/lib/audit";
import { requireSelfSession, selfGuardError } from "../../2fa/guard";

// Self-service passkey management (doc 23 wave 55): the signed-in
// staff member lists and deletes ONLY their own passkeys — the
// queries are scoped by the session's userId, and a row id belonging
// to another account answers the same 404 as a nonexistent id.
// Deletion is audited as auth.passkey.delete with the device label,
// so the security log shows which authenticator was removed.

export async function GET() {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });
  const passkeys = await listPasskeys(guard.userId);
  return NextResponse.json({ data: { passkeys } });
}

const deleteSchema = z.object({ id: z.string().min(1) });

export async function DELETE(req: Request) {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Passkey id is required." } },
      { status: 400 },
    );
  }
  const row = await prisma.staffWebAuthnCredential.findFirst({
    where: { id: parsed.data.id, userId: guard.userId },
    select: { id: true, deviceLabel: true, credentialId: true },
  });
  if (row === null) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Passkey not found." } },
      { status: 404 },
    );
  }
  const deleted = await deletePasskey(guard.userId, row.id);
  if (!deleted) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Passkey not found." } },
      { status: 404 },
    );
  }
  await writeAudit({
    actorId: guard.userId,
    action: "auth.passkey.delete",
    entityType: "StaffWebAuthnCredential",
    entityId: row.id,
    beforeJson: { deviceLabel: row.deviceLabel, credentialId: row.credentialId },
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  return NextResponse.json({ data: { status: "ok" } });
}
