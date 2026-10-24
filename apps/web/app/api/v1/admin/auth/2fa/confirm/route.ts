import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmTotpEnrollment } from "@/lib/auth";
import { requireSelfSession, selfGuardError } from "../guard";

// Self-service TOTP enrolment — confirm step.
// Body: { code: "123456" }. confirmTotpEnrollment sets twoFactorEnabled
// ONLY when the code verifies against the pending secret; every failure
// (bad shape, wrong code, missing/undecryptable secret) returns the
// same generic 401 as the login 2FA step — no oracle for which check
// failed. From the next login on, the account gets the TOTP step.
const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: Request) {
  const guard = await requireSelfSession();
  if (!guard.ok) return NextResponse.json(selfGuardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_CODE", message: "Invalid code. Please try again." } },
      { status: 401 },
    );
  }
  const ok = await confirmTotpEnrollment(guard.userId, parsed.data.code);
  if (!ok) {
    return NextResponse.json(
      { error: { code: "INVALID_CODE", message: "Invalid code. Please try again." } },
      { status: 401 },
    );
  }
  return NextResponse.json({ data: { status: "enabled" } });
}
