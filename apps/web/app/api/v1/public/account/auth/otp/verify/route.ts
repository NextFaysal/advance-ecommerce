/**
 * POST /api/v1/public/account/auth/otp/verify — complete OTP login
 * (doc 22 ADV-15).
 *
 * Body: { phone, code }. On a correct code the phone's Customer row
 * becomes the session's account — registration-by-OTP: an existing
 * row (password account or guest row from past checkouts) is used
 * as-is, a brand-new phone creates a passwordless account. The
 * session is minted by the SAME createCustomerSession + cookie the
 * password login route uses; nothing about the session differs by
 * sign-in method.
 *
 * Failures are generic: a wrong code, an expired code and a blocked
 * account never reveal whether the phone is registered. The durable
 * attempt cap (5 per code, persisted on the OtpCode row) is enforced
 * in the service; this route adds the shared per-IP+phone limiter
 * on top.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import { checkRateLimit } from "@/lib/rate-limit";
import { createCustomerSession } from "@/customer-auth/auth";
import { findOrCreateCustomerForPhone, verifyAuthOtp } from "@/customer-auth/otp";
import { errorResponse, methodNotAllowed, requestMeta, withSessionCookie } from "@/customer-auth/http";

const bodySchema = z.object({
  phone: z
    .string()
    .refine((v) => normalizeBdPhone(v) !== null, {
      message: "সঠিক বাংলাদেশি মোবাইল নম্বর দিন (01XXXXXXXXX)",
    })
    .transform((v) => normalizeBdPhone(v) as string),
  code: z.string().regex(/^\d{6}$/, "৬ সংখ্যার কোড দিন"),
});

const VERIFY_LIMIT_PER_10_MIN = 10;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    // Same generic failure as a wrong code — no input-shape oracle.
    return errorResponse("INVALID_CODE", "কোডটি সঠিক নয়। আবার চেষ্টা করুন।", 401);
  }
  const { phone, code } = parsed.data;
  const { ip, userAgent } = requestMeta(req);

  const rate = await checkRateLimit(`auth-otp-verify:${ip}:${phone}`, VERIFY_LIMIT_PER_10_MIN, 10 * 60 * 1000);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", 429, {
      retryAfterSeconds: rate.retryAfterSeconds,
    });
  }

  const result = await verifyAuthOtp(phone, code);
  if (!result.ok) {
    switch (result.error) {
      case "MISMATCH":
        return errorResponse("INVALID_CODE", "কোডটি সঠিক নয়। আবার চেষ্টা করুন।", 401, {
          attemptsLeft: result.attemptsLeft,
        });
      case "EXPIRED":
        return errorResponse("CODE_EXPIRED", "কোডটির মেয়াদ শেষ হয়ে গেছে। নতুন কোড নিন।", 401);
      case "TOO_MANY_ATTEMPTS":
        return errorResponse(
          "CODE_LOCKED",
          "অনেকবার ভুল কোড দেওয়া হয়েছে — এই কোডটি বন্ধ হয়ে গেছে। নতুন কোড নিন।",
          401,
        );
      default:
        return errorResponse("INVALID_CODE", "কোডটি সঠিক নয়। আবার চেষ্টা করুন।", 401);
    }
  }

  const customer = await findOrCreateCustomerForPhone(phone);
  if (customer === null) {
    // Blocked / soft-deleted account — generic, like every failure.
    return errorResponse("INVALID_CODE", "লগইন করা যায়নি। সহায়তার জন্য যোগাযোগ করুন।", 401);
  }

  const { token } = await createCustomerSession({ customerId: customer.id, ip, userAgent });
  const res = NextResponse.json({ data: { customer }, meta: { db: "PRISMA", method: "otp" } });
  return withSessionCookie(res, token);
}

export function GET() {
  return methodNotAllowed();
}
