import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { findStaffMemberById, regenerateStaffInvite } from "../../store";
import { createStaffInviteToken, staffInviteLink } from "../../invite-token";
import { recordDemoAudit } from "../../../audit-log/store";

// Resend a staff invite — POST: staff.manage.
// Regenerating the token REPLACES the stored hash, so every previously
// shared link immediately stops working. The new link is returned ONCE
// in this response (only its hash is stored). ADV-3: when the member
// has an email address, the new link is also enqueued as an invite
// email (src/email/send.ts) — queued is not delivered; the outcome
// rides in invite.email.
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

  const inviteLink = staffInviteLink(new URL(req.url).origin, token);

  // ADV-3: email the new link when the member has an address (same
  // honesty contract as the create route — queued is not delivered,
  // and a failure never fails the resend).
  let inviteEmail: { status: string; reason?: string } = {
    status: "not_queued",
    reason: "phone-only-invite",
  };
  if (member.email !== "") {
    try {
      const emailModule = await import("@/email/send");
      const result = await emailModule.enqueueStaffInviteEmail({
        userId: member.id,
        toEmail: member.email,
        inviteeName: member.name,
        roleName: member.role,
        inviteLink,
        expiresAtIso: expiresAt.toISOString(),
      });
      inviteEmail =
        result.email === "queued"
          ? { status: "queued" }
          : { status: "not_queued", reason: result.reason };
    } catch {
      inviteEmail = { status: "not_queued", reason: "queue-unavailable" };
    }
  }

  return NextResponse.json({
    data: {
      member,
      invite: {
        status: "created",
        delivered: false,
        channel: "manual_link",
        link: inviteLink,
        expiresAt: expiresAt.toISOString(),
        email: inviteEmail,
      },
    },
    meta: {
      persistence: "database",
      note: "A NEW invite link was generated; the previous link no longer works. The link is shown only in this response; when the member has an email address, the same link was also queued for email delivery (invite.email) — queued is not delivered.",
    },
  });
}
