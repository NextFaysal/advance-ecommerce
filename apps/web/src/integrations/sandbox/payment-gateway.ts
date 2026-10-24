// Sandbox PaymentGateway — bKash, Nagad, SSLCommerz. Agent 9, Step 20.
// SIMULATED ONLY: no real API call is made, no real key is read, and no
// money moves. initiate() returns a simulated hosted-checkout path on this
// app (/sandbox/checkout/<method>), never a real gateway URL. A sandbox
// "successful" verification is deterministic: verify() with the gateway
// transaction id issued by initiate() returns PAID for the attempted
// amount; any other transaction id returns FAILED with paidPoisha 0.
// Persistence: DB-backed since 2026-10-24 (./db-store.ts) — attempts are
// PaymentAttempt rows under a Payment parent in the real database; a
// replayed initiation returns the persisted attempt. Real adapters must
// replace this file's factory per provider and keep this interface.
import { z } from "zod";
import type {
  PaymentGateway,
  PaymentInitiateInput,
  PaymentInitiateResult,
  PaymentRefundInput,
  PaymentVerifyInput,
  PaymentVerifyResult,
} from "../payment";
import type { ProviderConfig, WebhookVerification } from "../types";
import { assertSandboxMode } from "./live-guard";
import { markOrderPayment } from "../../orders/repository";
import { sandboxAttemptId, sandboxGatewayTrxId } from "./deterministic";
import {
  applyAttemptStatus,
  findAttemptById,
  getOrCreateAttempt,
  recordRefund,
} from "./db-store";

export const SANDBOX_PAYMENT_METHODS = ["bkash", "nagad", "sslcommerz"] as const;
export type SandboxPaymentMethod = (typeof SANDBOX_PAYMENT_METHODS)[number];

export const sandboxPaymentConfig = (method: SandboxPaymentMethod): ProviderConfig => ({
  provider: method,
  enabled: true,
  mode: "sandbox",
  status: "configured",
  credentialRef: null, // sandbox needs no credential; live must have one
  lastTestedAt: null,
  lastError: null,
});

const initiateSchema = z.object({
  orderId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  customerPhone: z.string().min(11).max(15),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
  idempotencyKey: z.string().min(1),
});

export function createSandboxPaymentGateway(method: SandboxPaymentMethod): PaymentGateway {
  const config = sandboxPaymentConfig(method);
  return {
    method,
    config,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      assertSandboxMode(config);
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid payment initiate input.");
      const attempt = await getOrCreateAttempt({
        method,
        orderRef: parsed.data.orderId,
        amountPoisha: parsed.data.amountPoisha,
        attemptId: sandboxAttemptId(method, parsed.data.idempotencyKey),
        gatewayTransactionId: sandboxGatewayTrxId(method, parsed.data.idempotencyKey),
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: `/sandbox/checkout/${method}?attempt=${attempt.attemptId}`,
        gatewayTransactionId: attempt.gatewayTransactionId,
        status: attempt.status,
      };
    },
    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      assertSandboxMode(config);
      const attempt = await findAttemptById(input.paymentAttemptId);
      if (!attempt || attempt.method !== method) {
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        // Idempotent re-verify: no payment-side write happens here,
        // but re-running the order-paid funnel is itself idempotent
        // (alreadyApplied, no duplicate event) and self-heals an
        // order whose funnel call was missed earlier.
        await markOrderPayment(attempt.orderId, {
          paymentStatus: attempt.status,
          source: "gateway_verify",
          reference: attempt.attemptId,
        });
        return { status: attempt.status, paidPoisha: attempt.paidPoisha }; // idempotent re-verify
      }
      if (input.gatewayTransactionId !== attempt.gatewayTransactionId) {
        await applyAttemptStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      await applyAttemptStatus(attempt.attemptId, "PAID", attempt.amountPoisha);
      // Order-paid funnel: payment side is persisted above; the
      // funnel recomputes the linked Order's payment status from the
      // persisted rows and publishes payment.succeeded on the
      // transition into PAID.
      await markOrderPayment(attempt.orderId, {
        paymentStatus: "PAID",
        source: "gateway_verify",
        reference: attempt.attemptId,
      });
      return { status: "PAID", paidPoisha: attempt.amountPoisha };
    },
    async refund(input: PaymentRefundInput) {
      assertSandboxMode(config);
      const amount = z.number().int().positive().parse(input.amountPoisha);
      // Refunds are keyed by payment (attempt) id, as in the old store.
      const attempt = await findAttemptById(input.paymentId);
      if (!attempt || attempt.method !== method) throw new Error("Sandbox payment not found.");
      if (attempt.paidPoisha === 0) throw new Error("Cannot refund an unpaid payment.");
      if (attempt.refundedPoisha + amount > attempt.paidPoisha) {
        throw new Error("Refund exceeds paid amount.");
      }
      const result = await recordRefund({
        attemptId: attempt.attemptId,
        amountPoisha: amount,
        reason: input.reason,
      });
      if (!result) throw new Error("Sandbox payment not found.");
      // Order-paid funnel: the Refund row is persisted above; the
      // funnel recomputes the linked Order's payment status
      // (REFUNDED / PARTIALLY_REFUNDED by sums). Refunds never
      // publish payment.succeeded.
      await markOrderPayment(attempt.orderId, {
        paymentStatus: result.status,
        source: "gateway_refund",
        reference: attempt.attemptId,
      });
      return { status: result.status, refundedPoisha: result.refundedPoisha };
    },
    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // Direct adapter webhook calls are not used in sandbox: routes must go
      // through sandbox/webhook.ts processWebhook(), which supplies the
      // secret, checks idempotency, and logs. Returning false here prevents
      // an unverified, unlogged direct application.
      void _verification;
      return false;
    },
  };
}

export const sandboxBkashGateway = () => createSandboxPaymentGateway("bkash");
export const sandboxNagadGateway = () => createSandboxPaymentGateway("nagad");
export const sandboxSslcommerzGateway = () => createSandboxPaymentGateway("sslcommerz");
