import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createVendorSessionToken,
  isVendorPortalAuthConfigured,
  isVendorPortalEnabled,
  vendorSessionCookieOptions,
  VENDOR_SESSION_COOKIE,
  VENDOR_SESSION_TTL_MS,
} from "@/vendors/portal-auth";
import { verifyVendorLoginOtp } from "@/vendors/portal-otp";

// Vendor portal login, step 2 (ADV-13) — verify the one-time code
// and issue the session. The code is single-use (consumed by a
// successful verify). Errors never reveal whether the phone or the
// code was wrong beyond the generic invalid-code message; a
// REJECTED vendor is only told so AFTER their code matched.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isVendorPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
      { status: 403 },
    );
  }
  if (!isVendorPortalAuthConfigured()) {
    return NextResponse.json(
      { error: { code: "PORTAL_NOT_CONFIGURED", message: "Portal login is not configured on this install." } },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown; code?: unknown };
  const phone = typeof body.phone === "string" ? normalizeBdPhone(body.phone) : null;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!phone || !/^\d{6}$/.test(code)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "মোবাইল নম্বর ও ৬ সংখ্যার কোড দিন।" } },
      { status: 400 },
    );
  }
  const limit = await checkRateLimit(`vendor-login-verify:${phone}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }
  const vendor = await prisma.vendor.findFirst({
    where: { phone, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (vendor === null) {
    return NextResponse.json(
      { error: { code: "INVALID_CREDENTIALS", message: "মোবাইল নম্বর বা কোড মেলেনি।" } },
      { status: 401 },
    );
  }
  const verified = await verifyVendorLoginOtp(phone, code);
  if (!verified.ok) {
    switch (verified.error) {
      case "TOO_MANY_ATTEMPTS":
        return NextResponse.json(
          { error: { code: "TOO_MANY_ATTEMPTS", message: "অনেকবার ভুল কোড দেওয়া হয়েছে — নতুন কোড চান।" } },
          { status: 429 },
        );
      case "UNAVAILABLE":
        return NextResponse.json(
          { error: { code: "OTP_UNAVAILABLE", message: "এখন যাচাই করা যাচ্ছে না — কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
          { status: 503 },
        );
      default:
        return NextResponse.json(
          {
            error: { code: "INVALID_CODE", message: "কোডটি মেলেনি বা মেয়াদ শেষ — আবার চেষ্টা করুন।" },
            ...(verified.error === "MISMATCH" ? { meta: { attemptsLeft: verified.attemptsLeft } } : {}),
          },
          { status: 401 },
        );
    }
  }
  if (vendor.status === "REJECTED") {
    return NextResponse.json(
      { error: { code: "VENDOR_NOT_ACTIVE", message: "এই ভেন্ডর অ্যাকাউন্টটি প্রত্যাখ্যাত — স্টোরের সাথে যোগাযোগ করুন।" } },
      { status: 403 },
    );
  }
  const token = createVendorSessionToken(vendor.id);
  if (!token) {
    return NextResponse.json(
      { error: { code: "PORTAL_NOT_CONFIGURED", message: "Portal login is not configured on this install." } },
      { status: 503 },
    );
  }
  const res = NextResponse.json({
    data: { vendor: { id: vendor.id, shopName: vendor.name, phoneMasked: maskPhone(phone) } },
    meta: { persistence: "database" },
  });
  res.cookies.set(
    VENDOR_SESSION_COOKIE,
    token,
    vendorSessionCookieOptions(Math.floor(VENDOR_SESSION_TTL_MS / 1000)),
  );
  return res;
}
