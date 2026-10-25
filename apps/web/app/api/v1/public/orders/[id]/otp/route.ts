/**
 * POST /api/v1/public/orders/[id]/otp — verify an order OTP (doc 17, O3).
 *
 * The caller proves they hold the phone the order was placed with:
 * the body carries { phone, code } and the phone must match the
 * order's customerPhone (both normalized to +8801XXXXXXXXX) BEFORE
 * the code is ever checked. An unknown id and a phone mismatch return
 * the SAME generic 404 — the endpoint never reveals whether an order
 * exists, whether it needs an OTP, or which check failed.
 *
 * Success: { data: { verified: true }, meta } — src/orders/otp.ts owns
 * the lifecycle (5 attempts, 10-minute expiry, hash-only storage).
 * Errors use the public envelope { error: { code, message, details } }
 * with bilingual bn/en messages, like the neighbouring public routes.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@/checkout/validation";
import { checkOtpVerifyRate, verifyOrderOtp } from "@/orders/otp";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

const NOT_FOUND_MESSAGE = "অর্ডারটি পাওয়া যায়নি। / Order not found.";

const bodySchema = z.object({
  phone: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Code must be 6 digits."),
});

const VERIFY_ERRORS = {
  NOT_REQUIRED: {
    code: "OTP_NOT_REQUIRED",
    status: 400,
    message: "এই অর্ডারের জন্য OTP যাচাই প্রয়োজন নেই। / This order does not require OTP verification.",
  },
  ALREADY_VERIFIED: {
    code: "OTP_ALREADY_VERIFIED",
    status: 409,
    message: "এই অর্ডারটি ইতিমধ্যে OTP দিয়ে যাচাই করা হয়েছে। / This order is already OTP-verified.",
  },
  EXPIRED: {
    code: "OTP_EXPIRED",
    status: 400,
    message: "কোডটির মেয়াদ শেষ হয়ে গেছে। নতুন কোড পাঠাতে বলুন। / The code has expired. Request a new code.",
  },
  TOO_MANY_ATTEMPTS: {
    code: "OTP_TOO_MANY_ATTEMPTS",
    status: 429,
    message: "অনেকবার ভুল কোড দেওয়া হয়েছে। নতুন কোড পাঠিয়ে আবার চেষ্টা করুন। / Too many wrong attempts. Request a new code and try again.",
  },
  MISMATCH: {
    code: "OTP_MISMATCH",
    status: 400,
    message: "কোডটি মিলছে না। আবার চেষ্টা করুন। / The code does not match. Please try again.",
  },
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "সঠিক ফোন নম্বর ও ৬ সংখ্যার কোড দিন। / Provide the phone number and the 6-digit code.", 400);
  }

  // Phone binding FIRST: resolve the order and compare phones before
  // any code logic runs. Unknown id ≡ phone mismatch ≡ generic 404.
  const phone = normalizeBdPhone(parsed.data.phone);
  const order = await prisma.order.findUnique({
    where: { id },
    select: { customerPhone: true },
  });
  if (order === null || phone === null || order.customerPhone !== phone) {
    return err("ORDER_NOT_FOUND", NOT_FOUND_MESSAGE, 404);
  }

  if (!checkOtpVerifyRate(id, phone)) {
    return err(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন। / Too many attempts. Please wait a while and try again.",
      429,
    );
  }

  const result = await verifyOrderOtp(id, parsed.data.code);
  if (!result.ok) {
    const shape = VERIFY_ERRORS[result.error];
    return err(shape.code, shape.message, shape.status, result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : undefined);
  }

  return NextResponse.json({
    data: { verified: true },
    meta: { db: "PRISMA", source: "DATABASE" },
  });
}
