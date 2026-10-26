/**
 * POST /api/v1/public/account/register — create a customer account.
 *
 * Body: { name, phone, email?, password }. The phone is normalized to
 * +8801XXXXXXXXX. If a guest Customer row already exists for the phone
 * (from past checkouts) and has no password yet, registration CLAIMS
 * that row — its past orders become this account's order history. If
 * the phone already has an account, the error is generic (no phone-
 * existence enumeration). On success the customer is logged in
 * immediately (customer_session cookie) and { data: { customer } } is
 * returned. No password or token is ever returned in the body.
 */
import { NextResponse } from "next/server";
import {
  createCustomerSession,
  customerLoginRateKey,
  customerRegisterSchema,
  registerCustomer,
} from "@/customer-auth/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { errorResponse, methodNotAllowed, requestMeta, withSessionCookie } from "@/customer-auth/http";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = customerRegisterSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      "VALIDATION_ERROR",
      "তথ্য সঠিকভাবে দিন।",
      400,
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const { ip, userAgent } = requestMeta(req);
  const rateKey = customerLoginRateKey(ip, parsed.data.phone);
  // Same shared Redis-backed budget as the login route (same
  // `cust-login:` key, 5 attempts / 15 minutes per IP+phone), so
  // login and register attempts count against ONE budget again.
  // Semantics delta vs the old in-memory peek/record/reset trio
  // (wave 54): checkRateLimit counts EVERY register attempt —
  // successes included — and offers no reset-on-success, where the
  // trio counted failures only and cleared the count on success.
  // Stricter, never weaker. registerCustomer's own DB-side
  // protections are untouched.
  const rate = await checkRateLimit(rateKey, 5, 900_000);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", 429);
  }

  const result = await registerCustomer(parsed.data);
  if (result.status === "failed") {
    return errorResponse(
      "REGISTRATION_FAILED",
      "অ্যাকাউন্ট তৈরি করা যায়নি। তথ্য যাচাই করে আবার চেষ্টা করুন।",
      400,
    );
  }

  const { token } = await createCustomerSession({ customerId: result.customer.id, ip, userAgent });
  const res = NextResponse.json(
    { data: { customer: result.customer }, meta: { db: "PRISMA" } },
    { status: 201 },
  );
  return withSessionCookie(res, token);
}

export function GET() {
  return methodNotAllowed();
}
