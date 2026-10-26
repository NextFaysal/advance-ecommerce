/**
 * POST /api/v1/public/account/login — customer login (phone + password).
 *
 * Failures are always the same generic 401 — never reveal whether the
 * phone is registered or has an account. Throttling: a per-IP+phone
 * rate limit (5 attempts / 15 minutes, counted by the shared
 * Redis-backed limiter in src/lib/rate-limit.ts) plus a per-account
 * lockout (5 failed attempts → 30 minutes, enforced in
 * authenticateCustomer — untouched by the rate-limit migration).
 * Success sets the httpOnly `customer_session` cookie and returns
 * { data: { customer } }. There is NO password-reset flow yet (no live
 * SMS/email channel to deliver a reset code), and this API does not
 * pretend otherwise.
 */
import { NextResponse } from "next/server";
import {
  authenticateCustomer,
  createCustomerSession,
  customerLoginRateKey,
  customerLoginSchema,
} from "@/customer-auth/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { errorResponse, methodNotAllowed, requestMeta, withSessionCookie } from "@/customer-auth/http";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = customerLoginSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("INVALID_CREDENTIALS", "মোবাইল নম্বর বা পাসওয়ার্ড সঠিক নয়।", 401);
  }
  const { ip, userAgent } = requestMeta(req);
  const rateKey = customerLoginRateKey(ip, parsed.data.phone);
  // Same budget the old in-memory limiter enforced (5 per 15 minutes
  // per IP+phone), now counted across instances in Redis. Unlike the
  // old peek/record/reset trio, checkRateLimit counts EVERY attempt
  // (successes included) and offers no reset-on-success — stricter,
  // never weaker. The per-account lockout inside authenticateCustomer
  // still does the failure-based locking.
  const rate = await checkRateLimit(rateKey, 5, 900_000);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", 429);
  }

  const result = await authenticateCustomer(parsed.data);
  if (result.status === "failed") {
    return errorResponse("INVALID_CREDENTIALS", "মোবাইল নম্বর বা পাসওয়ার্ড সঠিক নয়।", 401);
  }

  const { token } = await createCustomerSession({ customerId: result.customer.id, ip, userAgent });
  const res = NextResponse.json({ data: { customer: result.customer }, meta: { db: "PRISMA" } });
  return withSessionCookie(res, token);
}

export function GET() {
  return methodNotAllowed();
}
