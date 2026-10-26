import { NextResponse } from "next/server";
import { z } from "zod";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { createSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { isIpAllowed, loadIpRules } from "@/security/ip-rules";
import { verifyAuthentication } from "@/security/webauthn";

// POST /api/v1/admin/auth/passkey/login/verify — step 2 of staff
// passkey sign-in. Body: { response } — the AuthenticationResponseJSON
// from the browser. On a verified assertion this creates the SAME
// session (createSession from src/lib/auth) and sets the SAME
// admin_session cookie as the password login route — a passkey login
// is indistinguishable downstream from a password login. The IP
// rules are enforced here as well as at the options step: this is
// the request that actually verifies a credential, so it gets the
// same pre-credential gate the password route applies to its single
// step. All failures return the password route's generic
// INVALID_CREDENTIALS shape.
const bodySchema = z.object({
  response: z
    .object({ id: z.string().min(1), type: z.literal("public-key") })
    .passthrough(),
});

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Login failed. Please try again." } },
      { status: 401 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `login:${ip}:passkey:${parsed.data.response.id}`;
  // Shared Redis limiter (the old lib/auth trio was retired in the
  // wave-55 leftovers migration): counts every attempt, no reset —
  // stricter-or-equal to the trio it replaces.
  const rate = await checkRateLimit(rateKey, 5, 900_000);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } },
      { status: 429 },
    );
  }
  const ipRules = await loadIpRules(getSetting);
  if (!isIpAllowed(ip, ipRules)) {
    await writeAudit({
      actorId: null,
      action: "auth.login_blocked",
      entityType: "StaffLogin",
      entityId: parsed.data.response.id,
      afterJson: { ip, via: "passkey" },
      reason: "ip_blocked",
      ip,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "Login failed. Please try again." } },
      { status: 403 },
    );
  }
  const result = await verifyAuthentication({
    response: parsed.data.response as unknown as AuthenticationResponseJSON,
    ip,
    userAgent: req.headers.get("user-agent") ?? undefined,
  });
  if (result.status === "failed") {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "Login failed. Please try again." } },
      { status: 401 },
    );
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
