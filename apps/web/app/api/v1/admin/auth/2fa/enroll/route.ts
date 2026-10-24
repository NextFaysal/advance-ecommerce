import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { enrollTotpSecret, hasUsableTotp } from "@/lib/auth";
import { requireSelfSession, selfGuardError } from "../guard";

// Self-service TOTP enrolment — start (POST) + status (GET).
//
// POST is the ONLY response that ever carries a plain TOTP secret, and
// only to the account holder over their own authenticated session: it
// is the one-time enrolment display SECURITY-NOTES.md allows (the
// secret is stored ONLY as an encrypted envelope by enrollTotpSecret).
// Starting enrolment REPLACES any stored secret — for an account with
// active 2FA this is a reset: old authenticator codes stop working
// immediately, and twoFactorEnabled stays on / is set by the confirm
// step once the first new code checks out (confirmTotpEnrollment).
// GET reports the usable state (flag AND secret — see hasUsableTotp),
// never the secret itself.

const ISSUER = "Advance Ecommerce";

export async function GET() {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const user = await prisma.user.findUnique({
    where: { id: guard.userId },
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }
  return NextResponse.json({
    data: {
      totpEnabled: hasUsableTotp(user),
      enrolmentPending: user.twoFactorSecret !== null && !user.twoFactorEnabled,
    },
  });
}

export async function POST() {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const user = await prisma.user.findUnique({
    where: { id: guard.userId },
    select: { email: true, phone: true },
  });
  if (!user) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin login required." } },
      { status: 401 },
    );
  }
  const account = user.email ?? user.phone ?? guard.userId;

  let secretBase32: string;
  try {
    ({ secretBase32 } = await enrollTotpSecret(guard.userId));
  } catch {
    // enrollTotpSecret throws only when AUTH_ENCRYPTION_KEY is missing/
    // invalid — a server misconfiguration, never the caller's fault.
    return NextResponse.json(
      { error: { code: "SERVER_MISCONFIGURED", message: "2FA enrolment is unavailable on this server right now." } },
      { status: 503 },
    );
  }

  const otpauthUrl =
    `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(account)}` +
    `?secret=${secretBase32}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;

  return NextResponse.json({
    data: { secretBase32, otpauthUrl, account },
    meta: { shownOnce: true, note: "Shown once — store it in the authenticator app now, then confirm with a code." },
  });
}
