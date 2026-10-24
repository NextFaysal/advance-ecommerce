import { NextResponse } from "next/server";
import { z } from "zod";
import { checkLoginRateLimit, hashPassword, recordLoginAttempt } from "@/lib/auth";
import { acceptStaffInvite, findPendingInviteByTokenHash } from "../../staff/store";
import { hashStaffInviteToken } from "../../staff/invite-token";
import { recordDemoAudit } from "../../audit-log/store";

// POST /api/v1/admin/auth/accept-invite — PUBLIC (the invite token IS the
// credential). The invitee sets their own name + password; the account
// activates and the token is burned (fields cleared), so the link can
// never be replayed. Every failure — unknown, expired, already used or
// revoked token — returns the SAME generic error: no enumeration of
// which case it was, and the raw token is never logged anywhere.
const GENERIC_FAILURE = {
  error: {
    code: "INVITE_INVALID",
    message: "আমন্ত্রণ লিংকটি অবৈধ বা এর মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য অ্যাডমিনের সাথে যোগাযোগ করুন।",
  },
} as const;

const acceptSchema = z.object({
  token: z.string().min(32).max(256),
  name: z.string().trim().min(1).max(120),
  // Same password policy as staff login (src/lib/auth.ts staffLoginSchema).
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "তথ্য সঠিক নয় — নাম ও কমপক্ষে ৮ অক্ষরের পাসওয়ার্ড দিন।" } },
      { status: 400 },
    );
  }

  // Throttle token guessing per IP (reuses the login rate limiter).
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `accept-invite:${ip}`;
  const rate = checkLoginRateLimit(rateKey, 10, 900);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
      { status: 429 },
    );
  }

  const invite = await findPendingInviteByTokenHash(hashStaffInviteToken(parsed.data.token));
  if (invite === null) {
    recordLoginAttempt(rateKey, 900);
    return NextResponse.json(GENERIC_FAILURE, { status: 400 });
  }

  await acceptStaffInvite({
    userId: invite.id,
    name: parsed.data.name,
    passwordHash: hashPassword(parsed.data.password),
  });

  await recordDemoAudit({
    actorId: invite.id,
    action: "staff.invite.accept",
    entityType: "User",
    entityId: invite.id,
    afterJson: { email: invite.email, phone: invite.phone, role: invite.role, status: "ACTIVE" },
    reason: "Staff invite accepted; account activated.",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json({
    data: { status: "accepted", loginPath: "/admin/login" },
    meta: { persistence: "database", note: "Invite token burned; the staff member can now log in at /admin/login." },
  });
}
