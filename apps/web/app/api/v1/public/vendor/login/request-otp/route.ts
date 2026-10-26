import { NextResponse } from "next/server";
import { maskPhone, normalizeBdPhone } from "@/checkout/validation";
import { checkRateLimit } from "@/lib/rate-limit";
import { isVendorPortalEnabled } from "@/vendors/portal-auth";
import { beginVendorLogin, VENDOR_OTP_TTL_MS } from "@/vendors/portal-otp";

// Vendor portal login, step 1 (ADV-13) — request a one-time code.
// The Vendor record carries no password/code credential, so the code
// IS the credential check: issued hash-only by portal-otp.ts and
// delivered over the sms-send queue. "delivery: queued" means the
// SMS job sits in Redis for the worker — never "sent" (see
// portal-otp.ts header for the full delivery chain).
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isVendorPortalEnabled()) {
    return NextResponse.json(
      { error: { code: "FEATURE_LOCKED", message: "Vendor portal is locked for this install (module.vendor_portal is OFF)." } },
      { status: 403 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { phone?: unknown };
  const phone = typeof body.phone === "string" ? normalizeBdPhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক মোবাইল নম্বর দিন (01[3-9]XXXXXXXX)।" } },
      { status: 400 },
    );
  }
  const limit = await checkRateLimit(`vendor-login-otp:${phone}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "অনেকবার চেষ্টা হয়েছে — কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
      { status: 429, headers: { "retry-after": String(limit.retryAfterSeconds) } },
    );
  }
  const result = await beginVendorLogin(phone);
  if (!result.ok) {
    switch (result.error) {
      case "VENDOR_NOT_FOUND":
        return NextResponse.json(
          { error: { code: "VENDOR_NOT_FOUND", message: "এই নম্বরে কোনো ভেন্ডর অ্যাকাউন্ট পাওয়া যায়নি।" } },
          { status: 404 },
        );
      case "VENDOR_NOT_ACTIVE":
        return NextResponse.json(
          { error: { code: "VENDOR_NOT_ACTIVE", message: "এই ভেন্ডর অ্যাকাউন্টটি প্রত্যাখ্যাত — স্টোরের সাথে যোগাযোগ করুন।" } },
          { status: 403 },
        );
      case "COOLDOWN":
      case "RATE_LIMITED":
        return NextResponse.json(
          { error: { code: result.error, message: "কিছুক্ষণ পরে আবার কোড চান।" } },
          { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
        );
      case "UNAVAILABLE":
        return NextResponse.json(
          { error: { code: "OTP_UNAVAILABLE", message: "এখন কোড পাঠানো যাচ্ছে না — কিছুক্ষণ পরে আবার চেষ্টা করুন।" } },
          { status: 503 },
        );
    }
  }
  return NextResponse.json({
    data: {
      requested: true,
      phoneMasked: maskPhone(phone),
      expiresInSeconds: Math.floor(VENDOR_OTP_TTL_MS / 1000),
    },
    meta: {
      delivery: result.delivery.enqueued ? "queued" : "not-queued",
      deliveryNote:
        "SMS job queued for the worker; actual delivery runs through the platform SMS adapter (simulated until a live SMS provider is connected in Admin > Settings).",
      otpStore: result.otpStoreBackend,
    },
  });
}
