import { NextResponse } from "next/server";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isResellerPortalEnabled } from "@/reseller/flags";
import {
  createResellerSessionToken,
  isPortalAuthConfigured,
  resellerSessionCookieOptions,
  RESELLER_SESSION_COOKIE,
  RESELLER_SESSION_TTL_MS,
  verifyResellerCode,
} from "@/reseller/portal-auth";

// Reseller portal login (ADV-12) — phone + attribution code.
// v1 credential: the code is the reseller's shared secret; comparison
// is hash-vs-hash timing-safe (portal-auth.ts). Only ACTIVE resellers
// can sign in. Rate-limited per phone via the shared limiter.
// Errors never reveal WHICH part failed (phone vs code vs status is
// only distinguished once the credential itself matched).
export const dynamic = "force-dynamic";

function locked() {
  return NextResponse.json(
    { error: { code: "FEATURE_LOCKED", message: "Reseller portal is locked for this install (module.reseller_portal is OFF)." } },
    { status: 403 },
  );
}

export async function POST(req: Request) {
  await ensureDbFeatureFlags().catch(() => {});
  if (!isResellerPortalEnabled()) return locked();
  if (!isPortalAuthConfigured()) {
    return NextResponse.json(
      { error: { code: "PORTAL_NOT_CONFIGURED", message: "Portal login is not configured on this install." } },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown; code?: unknown };
  const phone = typeof body.phone === "string" ? normalizeBdPhone(body.phone) : null;
  const code = typeof body.code === "string" ? body.code : "";
  if (!phone || !code) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক মোবাইল নম্বর ও আপনার রিসেলার কোড দিন।" } },
      { status: 400 },
    );
  }
  const limit = await checkRateLimit(`reseller-login:${phone}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }
  const row = await prisma.reseller.findUnique({
    where: { phone },
    select: { id: true, name: true, phone: true, status: true, code: true },
  });
  if (!row || !verifyResellerCode(row.code, code)) {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "মোবাইল নম্বর বা কোড মেলেনি।" } },
      { status: 401 },
    );
  }
  if (row.status !== "ACTIVE") {
    return NextResponse.json(
      { error: { code: "RESELLER_NOT_ACTIVE", message: "আপনার রিসেলার অ্যাকাউন্ট এখনো সক্রিয় নয় — স্টোরের সাথে যোগাযোগ করুন।" } },
      { status: 403 },
    );
  }
  const token = await createResellerSessionToken(row.id);
  if (!token) {
    return NextResponse.json(
      { error: { code: "PORTAL_NOT_CONFIGURED", message: "Portal login is not configured on this install." } },
      { status: 503 },
    );
  }
  const res = NextResponse.json({
    data: { reseller: { id: row.id, name: row.name, phoneMasked: maskPhone(row.phone) } },
    meta: { persistence: "database" },
  });
  res.cookies.set(
    RESELLER_SESSION_COOKIE,
    token,
    resellerSessionCookieOptions(Math.floor(RESELLER_SESSION_TTL_MS / 1000)),
  );
  return res;
}
