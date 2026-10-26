/**
 * POST /api/v1/public/account/auth/otp/request — issue a login OTP
 * (doc 22 ADV-15, spec §1: OTP-primary sign-in).
 *
 * Body: { phone }. The phone is normalised to +8801XXXXXXXXX exactly
 * like checkout/registration. A code is issued for ANY valid BD
 * number — an unknown phone is simply a future account
 * (registration-by-OTP happens at verify), so the response never
 * reveals whether the number is registered.
 *
 * Throttling: the shared Redis limiter (per IP+phone) plus the
 * durable service-level resend policy (60s cooldown, 5/hour, read
 * from the OtpCode rows themselves).
 *
 * HONESTY: `data.sent` + `meta.delivery: "queued"` mean the job is
 * on the sms-send queue — NOT that an SMS reached the phone. Delivery
 * needs the worker process, and `meta.deliveryMode` carries the
 * ADV-2 resolver's own verdict: "provider" when a real SMS gateway
 * is configured in Settings, "simulated" when sends fall back to the
 * sandbox adapter. When the queue itself is unreachable the meta
 * says "queue-unavailable" with the reason.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  checkAuthOtpResend,
  issueAuthOtp,
  resolveAuthOtpDelivery,
  sendAuthOtpSms,
} from "@/customer-auth/otp";
import { errorResponse, methodNotAllowed, requestMeta } from "@/customer-auth/http";

const bodySchema = z.object({
  phone: z
    .string()
    .refine((v) => normalizeBdPhone(v) !== null, {
      message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)",
    })
    .transform((v) => normalizeBdPhone(v) as string),
});

const REQUEST_LIMIT_PER_10_MIN = 5;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)।",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const phone = parsed.data.phone;
  const { ip } = requestMeta(req);

  const rate = await checkRateLimit(`auth-otp-req:${ip}:${phone}`, REQUEST_LIMIT_PER_10_MIN, 10 * 60 * 1000);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", 429, {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const resend = await checkAuthOtpResend(phone);
  if (!resend.allowed) {
    if (resend.error === "COOLDOWN") {
      return errorResponse(
        "TOO_SOON",
        `নতুন কোড ${resend.retryAfterSeconds ?? 60} সেকেন্ড পরে চাইতে পারবেন।`,
        429,
        { retryAfterSeconds: resend.retryAfterSeconds },
      );
    }
    return errorResponse("RATE_LIMITED", "এক ঘণ্টায় সর্বোচ্চ ৫টি কোড চাওয়া যায়। পরে আবার চেষ্টা করুন।", 429, {
      retryAfterSeconds: resend.retryAfterSeconds,
    });
  }

  const { otpId, code } = await issueAuthOtp(phone);
  const sms = await sendAuthOtpSms(otpId, code);
  const verdict = await resolveAuthOtpDelivery();

  return NextResponse.json({
    data: { sent: sms.enqueued, expiresInSeconds: 600 },
    meta: {
      // "queued" = the job is in Redis; delivery happens in the
      // worker through the configured provider — or is simulated
      // when deliveryMode says so. Never reported as "sent".
      delivery: sms.enqueued ? "queued" : "queue-unavailable",
      ...(sms.enqueued ? {} : { smsReason: sms.reason }),
      deliveryMode: verdict.mode,
      smsProvider: verdict.provider,
    },
  });
}

export function GET() {
  return methodNotAllowed();
}
