/**
 * Rocket manual payment — customer surface (ADV-4 remainder).
 *
 * GET  /api/v1/public/payments/rocket/trx
 *   → the public Rocket instructions: whether the method is
 *     configured and, when it is, the merchant Rocket number +
 *     account name the customer sends money to. The number is a
 *     receive-only number the store prints at checkout anyway —
 *     never a credential. meta states verification: "manual".
 *
 * POST /api/v1/public/payments/rocket/trx
 *   body { orderId, trxId, senderPhone, amountPoisha }
 *   → records the customer's payment CLAIM as the linked
 *     ManualTrxSubmission (PENDING) + PaymentAttempt (UNPAID) pair
 *     (src/payments/rocket-manual.ts). The response says
 *     "pending_verification" — a submission is never a confirmation.
 *     Staff verify/reject it in Admin > Payments (the manual TrxID
 *     review queue); only an approval flips the attempt through
 *     applyAttemptStatus at the exact claimed amount.
 */
import { NextResponse } from "next/server";
import { getRocketManualConfig, submitRocketTrx } from "@/payments/rocket-manual";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getRocketManualConfig();
  return NextResponse.json({
    data: {
      configured: config.configured,
      merchantNumber: config.configured ? config.merchantNumber : null,
      accountName: config.configured ? config.accountName : null,
    },
    meta: { verification: "manual", autoConfirmed: false },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const result = await submitRocketTrx(body);
  if (!result.ok) {
    const status =
      result.code === "INVALID_INPUT"
        ? 400
        : result.code === "ORDER_NOT_FOUND"
          ? 404
          : result.code === "NOT_CONFIGURED"
            ? 503
            : 409;
    return NextResponse.json(
      { error: { code: result.code, message: result.error } },
      { status },
    );
  }
  return NextResponse.json({
    data: {
      submissionId: result.submission.id,
      paymentAttemptId: result.paymentAttemptId,
      orderId: result.submission.orderId,
      status: result.state,
    },
    meta: { verification: "manual", autoConfirmed: false },
  });
}
