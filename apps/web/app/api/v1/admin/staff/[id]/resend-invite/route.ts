import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { findStaffMemberById, regenerateStaffInvite } from "../../store";
import { createStaffInviteToken, staffInviteLink } from "../../invite-token";
import { recordDemoAudit } from "../../../audit-log/store";

// Resend a staff invite — POST: staff.manage.
// Regenerating the token REPLACES the stored hash, so every previously
// shared link immediately stops working. The new link is returned ONCE
// in this response (only its hash is stored); no email is sent.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin("staff.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const { id } = await params;
  const existing = await findStaffMemberById(id);
  if (existing === null || !existing.invitePending) {
    return NextResponse.json(
      { error: { code: "INVITE_NOT_PENDING", message: "No pending invite exists for this staff member." } },
      { status: 404 },
    );
  }

  const { token, tokenHash, expiresAt } = createStaffInviteToken();
  const member = await regenerateStaffInvite({
    userId: id,
    inviteTokenHash: tokenHash,
    inviteExpiresAt: expiresAt,
  });
  if (member === null) {
    return NextResponse.json(
      { error: { code: "INVITE_NOT_PENDING", message: "No pending invite exists for this staff member." } },
      { status: 404 },
    );
  }

  await recordDemoAudit({
    actorId: guard.userId,
    action: "staff.invite.resend",
    entityType: "User",
    entityId: member.id,
    afterJson: { email: member.email, phone: member.phone, role: member.role, inviteExpiresAt: member.inviteExpiresAt },
    reason: "Staff invite resent (previous link invalidated).",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: {
      member,
      invite: {
        status: "created",
        delivered: false,
        channel: "manual_link",
        link: staffInviteLink(new URL(req.url).origin, token),
        expiresAt: expiresAt.toISOString(),
      },
    },
    meta: {
      persistence: "database",
      note: "A NEW invite link was generated; the previous link no longer works. NO email was sent — share the link manually; it is shown only in this response.",
    },
  });
}
