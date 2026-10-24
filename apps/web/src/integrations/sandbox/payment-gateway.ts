// Sandbox PaymentGateway — bKash, Nagad, SSLCommerz. Agent 9, Step 20.
// SIMULATED ONLY: no real API call is made, no real key is read, and no
// money moves. initiate() returns a simulated hosted-checkout path on this
// app (/sandbox/checkout/<method>), never a real gateway URL. A sandbox
// "successful" verification is deterministic: verify() with the gateway
// transaction id issued by initiate() returns PAID for the attempted
// amount; any other transaction id returns FAILED with paidPoisha 0.
// Real adapters must replace this file's factory per provider, keep this
// interface, and add: token/session handling, real signature verification,
// gateway error mapping, and DB persistence (payment_attempts) — the
// in-memory sandbox store below is not a substitute for that.
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
import { sandboxAttemptId, sandboxGatewayTrxId } from "./deterministic";
import { sandboxStore, type SandboxPaymentAttempt } from "./store";

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

function getOrCreateAttempt(method: SandboxPaymentMethod, input: PaymentInitiateInput): SandboxPaymentAttempt {
  const attemptId = sandboxAttemptId(method, input.idempotencyKey);
  const existing = sandboxStore.payments.get(attemptId);
  if (existing) return existing; // idempotent replay: same key, same attempt
  const attempt: SandboxPaymentAttempt = {
    attemptId,
    method,
    orderId: input.orderId,
    amountPoisha: input.amountPoisha,
    paidPoisha: 0,
    refundedPoisha: 0,
    gatewayTransactionId: sandboxGatewayTrxId(method, input.idempotencyKey),
    idempotencyKey: input.idempotencyKey,
    status: "UNPAID",
    createdAt: new Date().toISOString(),
  };
  sandboxStore.payments.set(attemptId, attempt);
  return attempt;
}

export function createSandboxPaymentGateway(method: SandboxPaymentMethod): PaymentGateway {
  const config = sandboxPaymentConfig(method);
  return {
    method,
    config,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      assertSandboxMode(config);
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid payment initiate input.");
      const attempt = getOrCreateAttempt(method, parsed.data);
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: `/sandbox/checkout/${method}?attempt=${attempt.attemptId}`,
        gatewayTransactionId: attempt.gatewayTransactionId,
        status: attempt.status,
      };
    },
    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      assertSandboxMode(config);
      const attempt = sandboxStore.payments.get(input.paymentAttemptId);
      if (!attempt || attempt.method !== method) {
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        return { status: attempt.status, paidPoisha: attempt.paidPoisha }; // idempotent re-verify
      }
      if (input.gatewayTransactionId !== attempt.gatewayTransactionId) {
        attempt.status = "FAILED";
        return { status: "FAILED", paidPoisha: 0 };
      }
      attempt.status = "PAID";
      attempt.paidPoisha = attempt.amountPoisha;
      return { status: "PAID", paidPoisha: attempt.paidPoisha };
    },
    async refund(input: PaymentRefundInput) {
      assertSandboxMode(config);
      const amount = z.number().int().positive().parse(input.amountPoisha);
      // Refunds are keyed by payment (attempt) id in the sandbox store.
      const attempt = sandboxStore.payments.get(input.paymentId);
      if (!attempt || attempt.method !== method) throw new Error("Sandbox payment not found.");
      if (attempt.paidPoisha === 0) throw new Error("Cannot refund an unpaid payment.");
      if (attempt.refundedPoisha + amount > attempt.paidPoisha) {
        throw new Error("Refund exceeds paid amount.");
      }
      attempt.refundedPoisha += amount;
      attempt.status = attempt.refundedPoisha >= attempt.paidPoisha ? "REFUNDED" : "PARTIALLY_REFUNDED";
      return { status: attempt.status, refundedPoisha: attempt.refundedPoisha };
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
