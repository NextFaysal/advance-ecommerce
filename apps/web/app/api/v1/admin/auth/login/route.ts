import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  authenticateStaff,
  createSession,
  signPending2fa,
  staffLoginSchema,
} from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { isIpAllowed, loadIpRules } from "@/security/ip-rules";

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
  // Shared Redis-backed limiter (src/lib/rate-limit.ts), same key
  // shape and same budget as the retired in-memory trio: 5 attempts
  // per 15 minutes per IP+identifier. Semantics delta (wave 52/54
  // migration pattern): checkRateLimit counts EVERY login attempt —
  // successes and IP-blocked tries included — at check time, and
  // offers no reset-on-success, where the trio counted failures only
  // (recordLoginAttempt) and cleared the count on success
  // (resetLoginRateLimit). Stricter, never weaker. The real account
  // protection is unchanged: the DB-backed per-account lockout
  // inside authenticateStaff (5 failures -> 30-minute lock) and the
  // login-alert hooks are untouched.
  const rate = await checkRateLimit(rateKey, 5, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } },
      { status: 429 },
    );
  }
  // ADV-28: staff-login IP rules (Setting doc `security.ip_rules`,
  // managed at /admin/security) are enforced BEFORE credential
  // verification. The refusal is the same generic shape as every other
  // login failure — it never reveals that an IP rule stopped the
  // attempt. loadIpRules fails open (empty rules) when the settings
  // read breaks, so a broken store can never lock every staff member
  // out; the blocked attempt already counted against the rate limit
  // at check time above (so a flood of blocked tries degrades to
  // 429s, not audit writes) and is audited under a system actor
  // (actorId null).
  const ipRules = await loadIpRules(getSetting);
  if (!isIpAllowed(ip, ipRules)) {
    await writeAudit({
      actorId: null,
      action: "auth.login_blocked",
      entityType: "StaffLogin",
      entityId: parsed.data.identifier,
      afterJson: { ip },
      reason: "ip_blocked",
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Login failed. Please try again." } },
      { status: 403 },
    );
  }
  const result = await authenticateStaff(parsed.data, {
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (result.status === "failed") {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Login failed. Please try again." } },
      { status: 401 },
    );
  }
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
    // Path must be "/": the guards read this cookie on /api/v1/admin/*
    // routes, and browsers never send a Path=/admin cookie to /api/*.
    path: "/",
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
