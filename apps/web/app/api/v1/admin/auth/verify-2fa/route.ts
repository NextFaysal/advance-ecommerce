import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSession, verifyPending2fa, verifyTotp } from "@/lib/auth";
import { z } from "zod";

// POST /api/v1/admin/auth/verify-2fa — contract used by app/admin/login/page.tsx
// Body: { code: "123456" }. Pending user comes ONLY from the httpOnly
// admin_pending_2fa cookie set by the login handler, never from the body.
// The cookie value is HMAC-signed: verifyPending2fa checks the signature
// and expiry first, and a tampered/expired/legacy-unsigned value fails
// closed with the same generic error as a bad code.
const bodySchema = z.object({ code: z.string().regex(/^\d{6}$/) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  const pendingUserId = verifyPending2fa(cookies().get("admin_pending_2fa")?.value);
  if (!parsed.success || !pendingUserId) {
    return NextResponse.json(
      { error: { code: "INVALID_CODE", message: "Invalid code. Please try again." } },
      { status: 401 },
    );
  }
  const ok = await verifyTotp(pendingUserId, parsed.data.code);
  if (!ok) {
    return NextResponse.json(
      { error: { code: "INVALID_CODE", message: "Invalid code. Please try again." } },
      { status: 401 },
    );
  }
  const { token } = await createSession({ userId: pendingUserId });
  const res = NextResponse.json({ data: { status: "ok" } });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    // Path must be "/": the guards read this cookie on /api/v1/admin/*
    // routes, and browsers never send a Path=/admin cookie to /api/*.
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60,
  });
  // Clear the pending cookie after successful 2FA.
  res.cookies.set("admin_pending_2fa", "", {
    httpOnly: true,
    path: "/api/v1/admin/auth/verify-2fa",
    maxAge: 0,
  });
  return res;
}
