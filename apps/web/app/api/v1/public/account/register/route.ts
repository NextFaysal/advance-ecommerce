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
  checkLoginRateLimit,
  recordLoginAttempt,
  resetLoginRateLimit,
} from "@/customer-auth/auth";
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
  const rate = checkLoginRateLimit(rateKey);
  if (!rate.allowed) {
    return errorResponse("RATE_LIMITED", "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।", 429);
  }

  const result = await registerCustomer(parsed.data);
  if (result.status === "failed") {
    recordLoginAttempt(rateKey);
    return errorResponse(
      "REGISTRATION_FAILED",
      "অ্যাকাউন্ট তৈরি করা যায়নি। তথ্য যাচাই করে আবার চেষ্টা করুন।",
      400,
    );
  }
  resetLoginRateLimit(rateKey);

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
