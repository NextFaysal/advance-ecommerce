/**
 * POST /api/v1/public/account/delete — self-service account
 * deletion, implemented as ANONYMISATION (ADV-29; the work itself
 * and the per-table decisions live in src/privacy/anonymise.ts).
 *
 * A live session is necessary but NOT sufficient — the customer must
 * re-prove control of the account in the same request:
 *
 *   - Password account   → re-enter the current password.
 *   - Passwordless (OTP) → a FRESH OTP challenge via the customer
 *     OTP service: POST { confirm: true } issues a code (queued SMS,
 *     same honest delivery meta as login) and answers
 *     { proofRequired: "otp" }; POST { confirm: true, otpCode }
 *     verifies and proceeds. The code is the login-grade challenge
 *     from src/customer-auth/otp.ts (single-use, attempt-capped).
 *   - Google-first account with a placeholder phone (`g:<sub>` —
 *     no dialable number exists, so an SMS code could never arrive)
 *     → type the account email exactly. Weaker than the other two,
 *     deliberately documented: it rides on the already-authenticated
 *     httpOnly session and only ever confirms THIS session's own
 *     account.
 *
 * On success every session row is deleted inside the anonymisation
 * transaction (this request's session included) and the response
 * clears the cookie. Signing in afterwards with the old phone —
 * password, OTP or Google — creates a FRESH account; the tombstone
 * row is never resurrected (register/OTP resolution refuse
 * deletedAt rows, and the old phone no longer exists on any row).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { normalizeBdPhone } from "@advance-ecommerce/validators";
import { verifyPassword } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  CUSTOMER_SESSION_COOKIE,
  customerSessionCookieOptions,
} from "@/customer-auth/auth";
import { errorResponse, requestMeta, requireCustomer, unauthorized } from "@/customer-auth/http";
import {
  checkAuthOtpResend,
  issueAuthOtp,
  resolveAuthOtpDelivery,
  sendAuthOtpSms,
  verifyAuthOtp,
} from "@/customer-auth/otp";
import { anonymiseCustomerAccount, type DeletionProof } from "@/privacy/anonymise";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  confirm: z.literal(true),
  password: z.string().min(1).max(128).optional(),
  otpCode: z.string().regex(/^\d{6}$/).optional(),
  emailConfirm: z.string().max(320).optional(),
});

export async function POST(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const raw: unknown = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return errorResponse(
      "CONFIRM_REQUIRED",
      "অ্যাকাউন্ট মুছতে হলে নিশ্চিতকরণ (confirm) আবশ্যিক।",
      400,
    );
  }

  // Proof attempts are precious: cap them per account.
  const limit = await checkRateLimit(`account-delete:${customer.id}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  const row = await prisma.customer.findUnique({ where: { id: customer.id } });
  if (row === null || row.deletedAt !== null) return unauthorized();

  let proof: DeletionProof;

  if (row.passwordHash !== null) {
    // ---- password proof ------------------------------------------------
    if (parsed.data.password === undefined) {
      return NextResponse.json({
        data: { proofRequired: "password" },
        meta: { persistence: "database" },
      });
    }
    if (!verifyPassword(parsed.data.password, row.passwordHash)) {
      return errorResponse("INVALID_PROOF", "পাসওয়ার্ড মিলেনি — আবার চেষ্টা করুন।", 403);
    }
    proof = "password";
  } else if (normalizeBdPhone(row.phone) !== null) {
    // ---- OTP proof (passwordless, dialable phone) ----------------------
    if (parsed.data.otpCode === undefined) {
      const resend = await checkAuthOtpResend(row.phone);
      if (!resend.allowed) {
        return errorResponse(
          "OTP_RESEND_BLOCKED",
          "কোড পাঠানোর সীমা পূর্ণ হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
          429,
          { retryAfterSeconds: resend.retryAfterSeconds },
        );
      }
      const { otpId, code } = await issueAuthOtp(row.phone);
      const sent = await sendAuthOtpSms(otpId, code);
      const delivery = await resolveAuthOtpDelivery();
      return NextResponse.json({
        data: { proofRequired: "otp", delivery: "queued", deliveryMode: delivery.mode },
        meta: {
          persistence: "database",
          smsEnqueued: sent.enqueued,
          note: "A fresh sign-in code was issued for this phone; enter it to confirm deletion. Enqueued is not delivered — the code arrives when the SMS worker runs.",
        },
      });
    }
    const verified = await verifyAuthOtp(row.phone, parsed.data.otpCode);
    if (!verified.ok) {
      return errorResponse("INVALID_PROOF", "কোডটি সঠিক নয় বা মেয়াদ শেষ।", 403, {
        otpError: verified.error,
      });
    }
    proof = "otp";
  } else {
    // ---- email-confirm proof (Google placeholder phone) ----------------
    if (parsed.data.emailConfirm === undefined) {
      return NextResponse.json({
        data: { proofRequired: "email" },
        meta: { persistence: "database" },
      });
    }
    const expected = (row.email ?? "").trim().toLowerCase();
    if (expected === "" || parsed.data.emailConfirm.trim().toLowerCase() !== expected) {
      return errorResponse("INVALID_PROOF", "ইমেইল মিলেনি — আবার চেষ্টা করুন।", 403);
    }
    proof = "email-confirm";
  }

  const { ip, userAgent } = requestMeta(req);
  const result = await anonymiseCustomerAccount(customer.id, { proof, ip, userAgent });
  if (result === null) return unauthorized();

  const res = NextResponse.json({
    data: {
      deleted: true,
      anonymised: true,
      ordersRetained: result.ordersRetained,
      note: "অ্যাকাউন্ট মুছে ফেলা হয়েছে — ব্যক্তিগত তথ্য বেনামে রূপান্তরিত হয়েছে। হিসাবের প্রয়োজনে অর্ডারের রেকর্ড সংরক্ষিত থাকবে (অর্ডারের ভেতরের নাম/ঠিকানা সেই রেকর্ডের অংশ)।",
    },
    meta: { persistence: "database", auditLogWritten: result.auditLogWritten },
  });
  // The session row is already deleted; clear the cookie too.
  res.cookies.set(CUSTOMER_SESSION_COOKIE, "", customerSessionCookieOptions(0));
  return res;
}
