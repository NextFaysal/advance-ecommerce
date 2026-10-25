/**
 * POST /api/v1/public/orders/[id]/otp/resend — (re)issue an order OTP
 * and queue its SMS (doc 17, O3). This is also the FIRST-issue path
 * when checkout flagged the order but no code was sent yet.
 *
 * Same phone binding as the verify endpoint: body { phone } must
 * match the order's customerPhone (normalized) before anything else;
 * unknown id ≡ phone mismatch ≡ generic 404.
 *
 * A 60-second cooldown between issues is enforced from the Order row
 * (otpExpiresAt − 10 min = last issue instant) and returns 429 with
 * retryAfterSeconds; an hourly per-(order, phone) cap applies on top.
 * Issuing a new code kills the previous one (hash replaced).
 *
 * HONESTY: a 200 here means a new code was issued and its SMS job was
 * QUEUED on the sms-send queue (meta.sms: "queued") — not that an SMS
 * was delivered. Delivery needs the VPS worker + a live SMS provider;
 * when the queue itself is unreachable meta.sms says
 * "queue-unavailable" with the reason. The issued code still stands
 * in the DB (hash only — nobody can read it back), so once the queue
 * is reachable a fresh resend issues a new code that supersedes it.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@/checkout/validation";
import { checkOtpResend, checkOtpResendRate, issueOrderOtp, sendOrderOtpSms } from "@/orders/otp";

function err(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

const NOT_FOUND_MESSAGE = "অর্ডারটি পাওয়া যায়নি। / Order not found.";

const bodySchema = z.object({
  phone: z.string().min(1),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as unknown;
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return err("INVALID_INPUT", "সঠিক ফোন নম্বর দিন। / Provide the phone number.", 400);
  }

  // Phone binding FIRST (see the verify route): unknown id ≡ phone
  // mismatch ≡ generic 404, decided before any OTP state is read.
  const phone = normalizeBdPhone(parsed.data.phone);
  const order = await prisma.order.findUnique({
    where: { id },
    select: { customerPhone: true },
  });
  if (order === null || phone === null || order.customerPhone !== phone) {
    return err("ORDER_NOT_FOUND", NOT_FOUND_MESSAGE, 404);
  }

  const check = await checkOtpResend(id);
  if (!check.allowed) {
    if (check.error === "COOLDOWN") {
      return err(
        "OTP_RESEND_COOLDOWN",
        "কিছুক্ষণ আগেই একটি কোড পাঠানো হয়েছে। একটু অপেক্ষা করে আবার চেষ্টা করুন। / A code was sent just now. Please wait a moment and try again.",
        429,
        { retryAfterSeconds: check.retryAfterSeconds },
      );
    }
    if (check.error === "ALREADY_VERIFIED") {
      return err(
        "OTP_ALREADY_VERIFIED",
        "এই অর্ডারটি ইতিমধ্যে OTP দিয়ে যাচাই করা হয়েছে। / This order is already OTP-verified.",
        409,
      );
    }
    return err(
      "OTP_NOT_REQUIRED",
      "এই অর্ডারের জন্য OTP যাচাই প্রয়োজন নেই। / This order does not require OTP verification.",
      400,
    );
  }

  if (!checkOtpResendRate(id, phone)) {
    return err(
      "RATE_LIMITED",
      "আজ অনেকবার কোড পাঠানো হয়েছে। পরে আবার চেষ্টা করুন। / Too many codes requested. Please try again later.",
      429,
    );
  }

  const { code } = await issueOrderOtp(id);
  const sms = await sendOrderOtpSms(id, code);

  return NextResponse.json({
    data: { sent: sms.enqueued, expiresInSeconds: 600 },
    meta: {
      db: "PRISMA",
      source: "DATABASE",
      // "queued" = the job is in Redis; delivery happens in the
      // worker, and a real SMS needs a live provider (see header).
      sms: sms.enqueued ? "queued" : "queue-unavailable",
      ...(sms.enqueued ? {} : { smsReason: sms.reason }),
    },
  });
}
