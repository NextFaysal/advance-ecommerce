/**
 * bKash LIVE PaymentGateway — ADV-4 (doc 22).
 *
 * Implements the shared PaymentGateway interface
 * (src/integrations/payment.ts) against the REAL bKash tokenized
 * checkout via ./client.ts, with persistence in the same
 * Payment/PaymentAttempt tables the sandbox gateway uses (./store.ts +
 * the shared writers in sandbox/db-store.ts) and — critically — the
 * SAME order-paid funnel the sandbox flow uses: applyAttemptStatus()
 * persists attempt+Payment, then markOrderPayment() recomputes the
 * Order's payment status from the persisted rows and publishes
 * payment.succeeded on the transition into PAID. There is no parallel
 * state machine here.
 *
 * Flow:
 *   initiate() — find-or-create the attempt (idempotency key), call
 *     bKash create-payment, store paymentID + bkashURL, hand the URL
 *     back as redirectUrl. The callbackURL given to bKash points at
 *     app/api/v1/public/payments/bkash/callback.
 *   verify() — called by the callback route with the paymentID bKash
 *     returned the customer with. Executes the payment server-side,
 *     then accepts ONLY transactionStatus "Completed" AND an executed
 *     amount exactly equal to the attempt amount; anything else fails
 *     honestly (see assertExecutedAmount — an amount mismatch throws
 *     and leaves the attempt UNPAID for staff reconciliation via
 *     query, because money may genuinely have moved at bKash).
 *   refund() — bKash refund call; the Refund row is recorded (via the
 *     sandbox layer's recordRefund, status COMPLETED) ONLY after
 *     bKash confirms the refund Completed (a status query settles an
 *     ambiguous first response). The order funnel then recomputes
 *     REFUNDED / PARTIALLY_REFUNDED from rows, as in sandbox.
 *   handleWebhook() — returns false: tokenized checkout has NO
 *     server-to-server payment webhook; completion is the browser
 *     callback + execute/query above. Nothing may be applied from an
 *     unauthenticated payload.
 *
 * This gateway is only constructed when Settings mode is "live" and
 * the credentials are complete (./resolver.ts enforces that). It never
 * reads Settings itself and never falls back to the sandbox theatre.
 */
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
import { markOrderPayment } from "../../orders/repository";
import { applyAttemptStatus, findAttemptById, recordRefund } from "../sandbox/db-store";
import {
  BkashProviderError,
  createBkashClient,
  type BkashAdapterOptions,
  type BkashClient,
  type BkashCredentials,
  type BkashExecution,
} from "./client";
import {
  createBkashAttempt,
  getAttemptGatewayResponseRef,
  setAttemptCreated,
  setAttemptExecuted,
} from "./store";

const initiateSchema = z.object({
  orderId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  customerPhone: z.string().min(11).max(15),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
  idempotencyKey: z.string().min(1),
});

export const bkashLiveConfig = (): ProviderConfig => ({
  provider: "bkash",
  enabled: true,
  mode: "live",
  status: "configured",
  credentialRef: "settings:payment.bkash",
  lastTestedAt: null,
  lastError: null,
});

/**
 * The acceptance rule for an executed payment, kept pure + exported so
 * it is smoke-testable without a database: the payment is PAID only
 * when bKash reports "Completed" for exactly the attempt amount. A
 * different amount throws AMOUNT_MISMATCH (the caller leaves the
 * attempt UNPAID — never mark paid for money we did not verify).
 */
export function assertExecutedAmount(execution: BkashExecution, expectedPoisha: number): void {
  if (execution.amountPoisha !== expectedPoisha) {
    throw new BkashProviderError(
      "AMOUNT_MISMATCH",
      `bKash executed amount (${execution.amountPoisha} poisha) does not match the order attempt amount (${expectedPoisha} poisha) — attempt left UNPAID for manual reconciliation.`,
    );
  }
}

/** Callback URL for bKash: our public callback route on the same
 *  origin as the customer return URL initiate.ts supplied. */
function callbackUrlFor(returnUrl: string): string {
  try {
    const origin = new URL(returnUrl).origin;
    return `${origin}/api/v1/public/payments/bkash/callback`;
  } catch {
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/api/v1/public/payments/bkash/callback`;
  }
}

export interface BkashGatewayOptions extends BkashAdapterOptions {
  /** Pre-built client (tests); default: real client, LIVE environment. */
  client?: BkashClient;
}

export function createBkashGateway(
  credentials: BkashCredentials,
  opts: BkashGatewayOptions = {},
): PaymentGateway {
  const client = opts.client ?? createBkashClient(credentials, "live", opts);
  const config = bkashLiveConfig();
  return {
    method: "bkash",
    config,
    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) throw new Error("Invalid payment initiate input.");
      const attempt = await createBkashAttempt({
        orderRef: parsed.data.orderId,
        amountPoisha: parsed.data.amountPoisha,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl: null,
          gatewayTransactionId: attempt.gatewayTransactionId || null,
          status: attempt.status,
        };
      }
      if (attempt.status === "FAILED") {
        // A failed attempt is terminal; a retry must come through a new
        // initiation key (initiate.ts keys per order, so staff use the
        // pay-link / manual path) — never resurrect it silently.
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl: null,
          gatewayTransactionId: attempt.gatewayTransactionId || null,
          status: "FAILED",
        };
      }
      // UNPAID: if create-payment already ran for this attempt (an
      // initiation replay), the stored bkashURL is still the redirect.
      const storedRef = await getAttemptGatewayResponseRef(attempt.attemptId);
      if (attempt.gatewayTransactionId && storedRef && storedRef.startsWith("https://")) {
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl: storedRef,
          gatewayTransactionId: attempt.gatewayTransactionId,
          status: "UNPAID",
        };
      }
      const created = await client.createPayment({
        amountPoisha: parsed.data.amountPoisha,
        payerReference: parsed.data.customerPhone,
        callbackUrl: callbackUrlFor(parsed.data.returnUrl),
        merchantInvoiceNumber: parsed.data.orderId,
      });
      await setAttemptCreated(attempt.attemptId, created.paymentID, created.bkashURL);
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: created.bkashURL,
        gatewayTransactionId: created.paymentID,
        status: "UNPAID",
      };
    },
    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      const attempt = await findAttemptById(input.paymentAttemptId);
      if (!attempt || attempt.method !== "bkash") {
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        // Idempotent re-verify (e.g. a doubled callback): no gateway
        // call, but re-running the funnel self-heals a missed earlier
        // funnel write — same contract as the sandbox gateway.
        await markOrderPayment(attempt.orderId, {
          paymentStatus: attempt.status,
          source: "gateway_verify",
          reference: attempt.attemptId,
        });
        return { status: attempt.status, paidPoisha: attempt.paidPoisha };
      }
      if (attempt.status === "FAILED") {
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (!attempt.gatewayTransactionId || input.gatewayTransactionId !== attempt.gatewayTransactionId) {
        await applyAttemptStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      const paymentID = attempt.gatewayTransactionId;
      let execution: BkashExecution;
      try {
        execution = await client.executePayment(paymentID);
      } catch (err) {
        // Execute can fail because the payment was ALREADY executed
        // (e.g. an earlier callback timed out after bKash committed).
        // Settle from the query endpoint instead of guessing.
        if (err instanceof BkashProviderError) {
          const queried = await client.queryPayment(paymentID);
          if (queried.transactionStatus !== "Completed") throw err;
          execution = queried;
        } else {
          throw err;
        }
      }
      if (execution.transactionStatus !== "Completed") {
        await applyAttemptStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      assertExecutedAmount(execution, attempt.amountPoisha);
      if (!execution.trxID) {
        throw new BkashProviderError(
          "UNRECOGNIZED_RESPONSE",
          "bKash reported a Completed payment without a trxID — attempt left UNPAID for manual reconciliation.",
        );
      }
      await setAttemptExecuted(attempt.attemptId, execution.trxID);
      await applyAttemptStatus(attempt.attemptId, "PAID", attempt.amountPoisha);
      await markOrderPayment(attempt.orderId, {
        paymentStatus: "PAID",
        source: "gateway_verify",
        reference: attempt.attemptId,
      });
      return { status: "PAID", paidPoisha: attempt.amountPoisha };
    },
    async refund(input: PaymentRefundInput) {
      const amount = z.number().int().positive().parse(input.amountPoisha);
      // Refunds are keyed by payment (attempt) id, as in the sandbox.
      const attempt = await findAttemptById(input.paymentId);
      if (!attempt || attempt.method !== "bkash") throw new Error("bKash payment not found.");
      if (attempt.paidPoisha === 0) throw new Error("Cannot refund an unpaid payment.");
      if (attempt.refundedPoisha + amount > attempt.paidPoisha) {
        throw new Error("Refund exceeds paid amount.");
      }
      const paymentID = attempt.gatewayTransactionId;
      const trxID = await getAttemptGatewayResponseRef(attempt.attemptId);
      if (!paymentID || !trxID || trxID.startsWith("https://")) {
        throw new Error("bKash payment is missing its executed transaction reference — cannot refund via gateway.");
      }
      const refunded = await client.refundPayment({
        paymentID,
        trxID,
        amountPoisha: amount,
        reason: input.reason,
        sku: `order-${attempt.orderId}`,
      });
      let finalStatus = refunded.transactionStatus;
      if (finalStatus !== "Completed") {
        const status = await client.queryRefund({ paymentID, refundTrxID: refunded.refundTrxID });
        finalStatus = status.transactionStatus;
      }
      if (finalStatus !== "Completed") {
        // Money is NOT confirmed back: record nothing and say so.
        throw new BkashProviderError(
          "REFUND_NOT_COMPLETED",
          `bKash refund did not complete (status: ${finalStatus}, refundTrxID: ${refunded.refundTrxID}) — no refund was recorded; reconcile in the bKash merchant panel.`,
        );
      }
      const result = await recordRefund({
        attemptId: attempt.attemptId,
        amountPoisha: amount,
        reason: input.reason,
      });
      if (!result) throw new Error("bKash payment not found.");
      await markOrderPayment(attempt.orderId, {
        paymentStatus: result.status,
        source: "gateway_refund",
        reference: attempt.attemptId,
      });
      return { status: result.status, refundedPoisha: result.refundedPoisha };
    },
    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // bKash tokenized checkout has no server-to-server payment
      // webhook: completion arrives via the customer callback route +
      // server-side execute/query in verify(). Refuse to apply any
      // unauthenticated payload here.
      void _verification;
      return false;
    },
  };
}
