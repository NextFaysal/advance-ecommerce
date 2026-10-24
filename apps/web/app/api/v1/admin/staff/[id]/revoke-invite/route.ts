import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { findStaffMemberById, revokeStaffInvite } from "../../store";
import { recordDemoAudit } from "../../../audit-log/store";

// Revoke a staff invite — POST: staff.manage.
// The token is cleared and the never-activated user row is soft-deleted:
// the invite link dies immediately, the member disappears from staff
// lists, and the email/phone can be invited again later.
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

  const revoked = await revokeStaffInvite(id);
  if (!revoked) {
    return NextResponse.json(
      { error: { code: "INVITE_NOT_PENDING", message: "No pending invite exists for this staff member." } },
      { status: 404 },
    );
  }

  await recordDemoAudit({
    actorId: guard.userId,
    action: "staff.invite.revoke",
    entityType: "User",
    entityId: id,
    beforeJson: { email: existing.email, phone: existing.phone, role: existing.role, status: existing.status },
    reason: "Staff invite revoked.",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: { revoked: true, id },
    meta: { persistence: "database", note: "Invite token cleared and the invited row soft-deleted." },
  });
}
