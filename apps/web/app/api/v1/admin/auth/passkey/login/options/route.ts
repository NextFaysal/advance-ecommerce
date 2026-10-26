import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { isIpAllowed, loadIpRules } from "@/security/ip-rules";
import { buildAuthenticationOptions } from "@/security/webauthn";

// POST /api/v1/admin/auth/passkey/login/options — step 1 of staff
// passkey sign-in (doc 23 wave 55). Mirrors the password login
// route's pre-credential defences exactly: the same rate-limit key
// and budget, and the ADV-28 IP rules enforced BEFORE any credential
// work, with the same generic refusal (never reveals that an IP rule
// stopped the attempt) and the same system-actor audit row.
// The options themselves never reveal whether the identifier exists
// or has passkeys — see buildAuthenticationOptions.
const bodySchema = z.object({ identifier: z.string().min(3).max(254) });

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Login failed. Please try again." } },
      { status: 400 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateKey = `login:${ip}:${parsed.data.identifier.toLowerCase()}`;
  // Shared Redis limiter (the old lib/auth trio was retired in the
  // wave-55 leftovers migration): counts every attempt, no reset.
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
      entityId: parsed.data.identifier,
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
  const result = await buildAuthenticationOptions(parsed.data.identifier);
  if (result.status === "not_configured") {
    return NextResponse.json(
      { error: { code: "PASSKEY_NOT_CONFIGURED", message: "Passkey sign-in is not configured on this server." } },
      { status: 503 },
    );
  }
  return NextResponse.json({ data: { options: result.options } });
}

export function GET() {
  return NextResponse.json(
    { error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." } },
    { status: 405 },
  );
}
