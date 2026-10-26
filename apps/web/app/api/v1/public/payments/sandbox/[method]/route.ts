/**
 * Public sandbox checkout completion — doc 21 W0-C (G3-6).
 *
 * GET  /api/v1/public/payments/sandbox/[method]?attempt=<id>
 * POST /api/v1/public/payments/sandbox/[method]  { attemptId, action }
 *
 * WHY THIS ROUTE EXISTS: payment initiation (src/payments/initiate.ts)
 * and pay links (src/storefront-ux/pay-link-view.ts) hand the customer
 * the simulated hosted-checkout URL /sandbox/checkout/<method>?attempt=…
 * — the page that URL points to is backed by this route. The only other
 * completion seam is the provider webhook (HMAC-signed with a server
 * secret a browser must never hold), so the simulated checkout needs
 * its own public seam. NO new state machine lives here: completion is
 * driven through the sandbox gateway's own verify()
 * (src/integrations/sandbox/payment-gateway.ts), the function that owns
 * the attempt transitions — applyAttemptStatus + the markOrderPayment
 * funnel, the same two writes the verified webhook performs.
 *
 * HOW THE TWO ACTIONS MAP ONTO THE GATEWAY'S DETERMINISTIC RULE:
 * verify() returns PAID iff the presented gatewayTransactionId equals
 * the id initiate() issued, and FAILED for any other id (the gateway's
 * documented contract). So:
 *  - action "success" presents the attempt's own issued transaction id
 *    — exactly what a real gateway callback would present;
 *  - action "fail" presents a sentinel that can never be an issued id
 *    (issued ids are SBX-TRX<METHOD>-<HASH8>), i.e. the simulated
 *    wrong-OTP / declined outcome, and the gateway itself marks FAILED.
 *
 * HARD GATES (anything else 404s, like the attempt never existed):
 *  - method must be one of SANDBOX_PAYMENT_METHODS;
 *  - the method's Settings mode must be "sandbox" — if an admin flips
 *    the method to "live", this simulated checkout closes (initiation
 *    already refuses live mode; a stale sandbox URL must not complete);
 *  - the attempt must exist AND belong to the method in the path.
 * Only an UNPAID attempt can be acted on; a resolved attempt reports
 * 409 ALREADY_RESOLVED and its state is readable via GET / the page.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSandboxPaymentGateway,
  SANDBOX_PAYMENT_METHODS,
  type SandboxPaymentMethod,
} from "@/integrations/sandbox/payment-gateway";
import { findAttemptById, resolveOrderRef } from "@/integrations/sandbox/db-store";
import type { SandboxPaymentAttempt } from "@/integrations/sandbox/store";
import { getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Never an issued id: issued ids are SBX-TRX<METHOD>-<HASH8>. */
const SIMULATED_FAILURE_TRX_ID = "SANDBOX-ABORTED-BY-CUSTOMER";

async function loadGatedAttempt(
  methodRaw: string,
  attemptId: string | null,
): Promise<SandboxPaymentAttempt | null> {
  if (!(SANDBOX_PAYMENT_METHODS as readonly string[]).includes(methodRaw)) return null;
  if (!attemptId) return null;
  const mode = (await getSetting(`payment.${methodRaw}.mode`)) ?? "sandbox";
  if (mode !== "sandbox") return null;
  const attempt = await findAttemptById(attemptId);
  if (!attempt || attempt.method !== methodRaw) return null;
  return attempt;
}

function notFound() {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: "Sandbox payment attempt not found." } },
    { status: 404 },
  );
}

export async function GET(req: Request, { params }: { params: { method: string } }) {
  const attemptId = new URL(req.url).searchParams.get("attempt");
  const attempt = await loadGatedAttempt(params.method, attemptId);
  if (!attempt) return notFound();
  const order = await resolveOrderRef(attempt.orderId);
  return NextResponse.json({
    data: {
      attemptId: attempt.attemptId,
      method: attempt.method,
      status: attempt.status,
      amountPoisha: attempt.amountPoisha,
      paidPoisha: attempt.paidPoisha,
      orderNo: order?.orderNo ?? null,
    },
    meta: { sandbox: true },
  });
}

const bodySchema = z.object({
  attemptId: z.string().min(1),
  action: z.enum(["success", "fail"]),
});

export async function POST(req: Request, { params }: { params: { method: string } }) {
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid sandbox checkout action." } },
      { status: 400 },
    );
  }
  const attempt = await loadGatedAttempt(params.method, parsed.data.attemptId);
  if (!attempt) return notFound();
  if (attempt.status !== "UNPAID") {
    return NextResponse.json(
      {
        error: {
          code: "ALREADY_RESOLVED",
          message: `This sandbox attempt is already ${attempt.status} — a resolved checkout cannot be completed again.`,
        },
      },
      { status: 409 },
    );
  }
  const gateway = createSandboxPaymentGateway(params.method as SandboxPaymentMethod);
  const result = await gateway.verify({
    paymentAttemptId: attempt.attemptId,
    gatewayTransactionId:
      parsed.data.action === "success" ? attempt.gatewayTransactionId : SIMULATED_FAILURE_TRX_ID,
    // The sandbox gateway's verify() does not consume an idempotency
    // key (its writes are naturally idempotent per attempt), but the
    // PaymentGateway interface requires one — keyed per attempt+action
    // so a replayed completion is recognisably the same operation.
    idempotencyKey: `sandbox-checkout:${attempt.attemptId}:${parsed.data.action}`,
  });
  return NextResponse.json({
    data: { status: result.status, paidPoisha: result.paidPoisha },
    meta: { sandbox: true },
  });
}
