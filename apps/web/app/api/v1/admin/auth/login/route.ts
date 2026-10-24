import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  authenticateStaff,
  checkLoginRateLimit,
  createSession,
  recordLoginAttempt,
  resetLoginRateLimit,
  signPending2fa,
  staffLoginSchema,
} from "@/lib/auth";

// POST /api/v1/admin/auth/login — contract used by app/admin/login/page.tsx
// Returns { data: { status: "ok" | "needs_2fa" } } on success,
// generic { error: { code, message } } on failure (never reveals if identifier exists).
// No password, OTP, or session token is ever logged or returned in the body.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = staffLoginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Login failed. Please try again." } },
      { status: 400 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `login:${ip}:${parsed.data.identifier.toLowerCase()}`;
  const rate = checkLoginRateLimit(rateKey);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } },
      { status: 429 },
    );
  }
  const result = await authenticateStaff(parsed.data, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (result.status === "failed") {
    recordLoginAttempt(rateKey);
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Login failed. Please try again." } },
      { status: 401 },
    );
  }
  resetLoginRateLimit(rateKey);
  if (result.status === "needs_2fa") {
    // The pending cookie value is SIGNED (HMAC-SHA256, see signPending2fa
    // in lib/auth) — it is httpOnly and short-lived (10 min), only gates
    // the TOTP step, and verify-2fa rejects tampered/expired values.
    // Signing throws if AUTH_ENCRYPTION_KEY is missing/invalid: fail the
    // login with a generic error rather than issue an unsigned cookie.
    let pendingCookie: string;
    try {
      pendingCookie = signPending2fa(result.userId);
    } catch {
      return NextResponse.json(
        { error: { code: "INTERNAL", message: "Login failed. Please try again." } },
        { status: 500 },
      );
    }
    const res = NextResponse.json({ data: { status: "needs_2fa" } });
    res.cookies.set("admin_pending_2fa", pendingCookie, {
      httpOnly: true,
      path: "/api/v1/admin/auth/verify-2fa",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
    });
    return res;
  }
  const { token } = await createSession({
    userId: result.userId,
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  const res = NextResponse.json({ data: { status: "ok" } });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    path: "/admin",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60,
  });
  return res;
}

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
    { status: 405 },
  );
}

// Keep cookies import used in case a future GET session check is added here.
void cookies;
