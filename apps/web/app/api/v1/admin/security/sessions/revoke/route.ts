import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { hashSessionToken, validateSessionToken } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";

// Revoke ONE active staff session (ADV-28 core) — the action behind
// the /admin/security sessions card. Revoking is a soft state change
// (revokedAt = now); validateSessionToken already refuses revoked
// rows, so the target is signed out on their next request.
//
// Rules, in check order:
// - `reason` is REQUIRED (400 without one) and lands in the AuditLog.
// - The caller's OWN current session cannot be revoked here (409) —
//   ending your own session is what "log out" is for; this guard also
//   stops a staff member locking themselves out by misclick.
// - Unknown session -> 404; already revoked or already expired ->
//   409 SESSION_NOT_ACTIVE. The update itself is conditional
//   (updateMany on still-active rows) so a double-submit race can
//   never "re-revoke" or report success twice.
//
// Guard: a valid staff session PLUS the `staff.manage` permission
// (parent integration tightening) — revoking another person's
// session is a staff-administration action, not a self-service one,
// so the read-only sibling pattern (session-only) is not enough here.
// The sessions LIST route stays session-only (read oversight).

const revokeSchema = z.object({
  sessionId: z.string().trim().min(1, "sessionId is required."),
  reason: z.string().trim().min(1, "A reason is required to revoke a session."),
});

export async function POST(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }

  let caller: Awaited<ReturnType<typeof validateSessionToken>>;
  try {
    caller = await validateSessionToken(token);
  } catch {
    return NextResponse.json(
      { error: { code: "PRISMA_PENDING", message: "Session validation unavailable." } },
      { status: 503 },
    );
  }
  if (!caller) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Session expired. Login again." } },
      { status: 401 },
    );
  }
  if (!caller.user.permissions.includes("staff.manage")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "You need the staff.manage permission to revoke sessions." } },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "sessionId and a non-empty reason are required.",
          details: parsed.error.issues,
        },
      },
      { status: 400 },
    );
  }
  const { sessionId, reason } = parsed.data;

  try {
    const target = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, tokenHash: true, revokedAt: true, expiresAt: true },
    });
    if (!target) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Session not found." } },
        { status: 404 },
      );
    }
    if (target.id === caller.sessionId || target.tokenHash === hashSessionToken(token)) {
      return NextResponse.json(
        {
          error: {
            code: "CANNOT_REVOKE_OWN_SESSION",
            message: "You cannot revoke your own current session here — log out instead.",
          },
        },
        { status: 409 },
      );
    }
    const now = new Date();
    if (target.revokedAt !== null || target.expiresAt <= now) {
      return NextResponse.json(
        {
          error: {
            code: "SESSION_NOT_ACTIVE",
            message: "This session is already revoked or expired.",
          },
        },
        { status: 409 },
      );
    }

    const updated = await prisma.session.updateMany({
      where: { id: target.id, revokedAt: null, expiresAt: { gt: now } },
      data: { revokedAt: now },
    });
    if (updated.count === 0) {
      return NextResponse.json(
        {
          error: {
            code: "SESSION_NOT_ACTIVE",
            message: "This session is already revoked or expired.",
          },
        },
        { status: 409 },
      );
    }

    await writeAudit({
      actorId: caller.user.id,
      action: "security.session_revoke",
      entityType: "Session",
      entityId: target.id,
      reason,
      beforeJson: { targetUserId: target.userId, wasActive: true },
      afterJson: { revokedAt: now.toISOString() },
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({
      data: { id: target.id, revoked: true },
      meta: { persistence: "database", source: "Session table via Prisma" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "PRISMA_PENDING", message: "Session revoke unavailable." } },
      { status: 503 },
    );
  }
}
