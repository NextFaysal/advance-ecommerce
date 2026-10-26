/**
 * Upay LIVE adapter — ADV-4 remainder (doc 22).
 *
 * A REAL PaymentGateway (src/integrations/payment.ts) for Upay (UCB
 * Fintech), structured exactly like the SSLCommerz adapter:
 *  - initiate(): create a hosted payment session keyed by OUR
 *    PaymentAttempt id as the merchant invoice id, and return the
 *    gateway's hosted-checkout URL for the redirect.
 *  - verify(): the ONLY confirmation path. Called by the callback /
 *    IPN routes; it queries the gateway server-side by invoice id
 *    and confirms ONLY when the gateway's own record matches the
 *    persisted attempt: outcome success, invoice id == attempt id,
 *    currency BDT (when reported), and the amount — parsed from the
 *    BDT decimal into integer poisha — EXACTLY equal to the attempt
 *    amount. Browser parameters are never trusted as evidence.
 *  - refund(): REFUND_UNSUPPORTED. No Upay merchant refund operation
 *    is grounded in any public source, so — like the Nagad adapter —
 *    this refuses rather than inventing a call. Upay refunds are
 *    issued from the Upay merchant panel and recorded in the refund
 *    workbench until Upay documents an API.
 *
 * ⚠️ WIRE FORMAT: every provider URL/path/field/status string lives
 * in ./upay/provider-http.ts and is UNVERIFIED against Upay's
 * official merchant API documentation (issued only to onboarded
 * merchants). The confirmation logic above is fully real and fails
 * closed; the wire constants are the part awaiting the merchant
 * document. See the provider-http header before enabling live mode.
 *
 * Credentials are constructor inputs resolved from the encrypted
 * Admin Settings store by src/payments/live-gateways.ts
 * (payment.upay.merchant_id / .merchant_key / .merchant_code + the
 * optional profile fields) — never logged, never in an error.
 *
 * Confirmation writes go through the shared funnel
 * (src/payments/live-store.ts -> sandbox db-store applyAttemptStatus
 * / recordRefund + orders markOrderPayment), the same path every
 * other gateway uses. No second state machine.
 */
import { z } from "zod";
import type {
  PaymentGateway,
  PaymentInitiateInput,
  PaymentInitiateResult,
  PaymentRefundInput,
  PaymentVerifyInput,
  PaymentVerifyResult,
} from "./payment";
import type { ProviderConfig, WebhookVerification } from "./types";
import {
  bdtDecimalToPoisha,
  liveAttemptId,
  poishaToBdtDecimal,
  prismaLivePaymentStore,
  type LivePaymentStore,
} from "../payments/live-store";
import {
  UPAY_API_PATHS,
  UPAY_BASE_URLS,
  buildUpayCreatePayload,
  parseUpayCreateResponse,
  parseUpayQueryResponse,
  type UpayCredentials,
  type UpayMode,
} from "./upay/provider-http";

export type { UpayCredentials, UpayMode } from "./upay/provider-http";
export { UPAY_BASE_URLS } from "./upay/provider-http";

export class UpayError extends Error {
  /** NOT_CONFIGURED | INVALID_INPUT | NETWORK | HTTP_<status> |
   *  INIT_REJECTED | INVOICE_MISMATCH | AMOUNT_MISMATCH |
   *  REFUND_UNSUPPORTED | UNRECOGNIZED_RESPONSE | ATTEMPT_NOT_FOUND */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UpayError";
    this.code = code;
  }
}

export type UpayFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface UpayAdapterOptions {
  mode: UpayMode;
  /** Settings payment.upay.api_base_url override (the real gateway
   *  host is settled by Upay's official document). */
  baseUrl?: string;
  fetchFn?: UpayFetch;
  timeoutMs?: number;
  store?: LivePaymentStore;
}

const DEFAULT_TIMEOUT_MS = 20_000;

const initiateSchema = z.object({
  orderId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  customerPhone: z.string().min(11).max(15),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
  idempotencyKey: z.string().min(1),
});

/** yyyy-mm-dd in Asia/Dhaka (the merchant API's create operation is
 *  date-keyed; the platform timezone is Asia/Dhaka throughout). */
export function dhakaDateString(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function createUpayGateway(
  credentials: UpayCredentials,
  options: UpayAdapterOptions,
): PaymentGateway {
  if (
    credentials.merchantId.trim() === "" ||
    credentials.merchantKey.trim() === "" ||
    credentials.merchantCode.trim() === ""
  ) {
    throw new UpayError(
      "NOT_CONFIGURED",
      "Upay is not configured — merchant_id / merchant_key / merchant_code missing from Settings.",
    );
  }
  const baseUrl = (options.baseUrl ?? "").trim().replace(/\/$/, "") || UPAY_BASE_URLS[options.mode];
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const store = options.store ?? prismaLivePaymentStore;

  const config: ProviderConfig = {
    provider: "upay",
    enabled: true,
    mode: options.mode,
    status: "configured",
    // Reference only — the credential values never travel in config.
    credentialRef: "settings:payment.upay",
    lastTestedAt: null,
    lastError: null,
  };

  async function callApi(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Network errors can embed the URL (whose query string may
      // carry merchant auth material on the query call) — report the
      // failure class only, never the URL.
      throw new UpayError("NETWORK", "Upay request failed (network/timeout).");
    }
    if (!response.ok) {
      throw new UpayError(`HTTP_${response.status}`, `Upay request failed (HTTP ${response.status}).`);
    }
    return response.json().catch(() => null);
  }

  /** The server-side query-by-invoice call shared by verify(). */
  async function queryWithGateway(invoiceId: string) {
    const query = new URLSearchParams({
      merchant_id: credentials.merchantId,
      merchant_code: credentials.merchantCode,
      merchant_key: credentials.merchantKey,
    });
    const data = await callApi(
      `${UPAY_API_PATHS.queryByInvoice}/${encodeURIComponent(invoiceId)}?${query.toString()}`,
      { method: "GET" },
    );
    const record = parseUpayQueryResponse(data, bdtDecimalToPoisha);
    if (record === null) {
      throw new UpayError(
        "UNRECOGNIZED_RESPONSE",
        "Upay query response had no recognisable status — refusing to confirm.",
      );
    }
    return record;
  }

  return {
    method: "upay",
    config,

    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) {
        throw new UpayError("INVALID_INPUT", "Invalid Upay initiate input.");
      }
      const attemptId = liveAttemptId("upay", parsed.data.idempotencyKey);
      const attempt = await store.getOrCreateAttempt({
        method: "upay",
        orderRef: parsed.data.orderId,
        amountPoisha: parsed.data.amountPoisha,
        attemptId,
        // invoice_id == attempt id: unique per initiation, and the
        // key every later callback/query resolves by.
        gatewayTransactionId: attemptId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (attempt.status !== "UNPAID") {
        // Replay of an already-resolved attempt: report its state,
        // never open a second gateway session for it.
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl: null,
          gatewayTransactionId: attempt.gatewayTransactionId,
          status: attempt.status,
        };
      }
      const payload = buildUpayCreatePayload(
        credentials,
        {
          invoiceId: attemptId,
          amountPoisha: parsed.data.amountPoisha,
          customerPhone: parsed.data.customerPhone,
          appOrigin: new URL(parsed.data.returnUrl).origin,
          dateDhaka: dhakaDateString(),
        },
        poishaToBdtDecimal(parsed.data.amountPoisha),
      );
      const data = await callApi(UPAY_API_PATHS.create, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const record = parseUpayCreateResponse(data);
      if (record === null) {
        throw new UpayError(
          "INIT_REJECTED",
          "Upay did not return a recognisable hosted-checkout URL for the session.",
        );
      }
      if (record.gatewayTransactionId !== null) {
        // Park the gateway's own transaction id for reconciliation.
        await store.setGatewayResponseRef(attempt.attemptId, record.gatewayTransactionId);
      }
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: record.paymentUrl,
        gatewayTransactionId: attempt.gatewayTransactionId,
        status: attempt.status,
      };
    },

    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      const attempt = await store.findAttemptById(input.paymentAttemptId);
      if (!attempt || attempt.method !== "upay") {
        throw new UpayError("ATTEMPT_NOT_FOUND", "Upay attempt not found.");
      }
      if (
        attempt.status === "PAID" ||
        attempt.status === "PARTIALLY_REFUNDED" ||
        attempt.status === "REFUNDED"
      ) {
        // Idempotent re-verify: re-running the order funnel self-heals
        // an order whose earlier funnel call was missed (sandbox parity).
        await store.markOrderPayment(attempt.orderId, {
          paymentStatus: attempt.status,
          source: "gateway_verify",
          reference: attempt.attemptId,
        });
        return { status: attempt.status, paidPoisha: attempt.paidPoisha };
      }
      // The query is keyed by OUR invoice id (the attempt id) — the
      // callback-supplied reference is never the lookup key, so a
      // forged callback cannot point verify() at someone else's
      // payment. The gateway's own record is the only evidence.
      const record = await queryWithGateway(attempt.attemptId);
      if (record.invoiceId !== "" && record.invoiceId !== attempt.attemptId) {
        await store.applyStatus(attempt.attemptId, "FAILED");
        throw new UpayError(
          "INVOICE_MISMATCH",
          "Upay query record invoice_id does not match the payment attempt.",
        );
      }
      if (record.outcome === "failed") {
        await store.applyStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (record.outcome !== "success") {
        // pending / unknown: NEVER confirm. The attempt stays UNPAID
        // and a later IPN / callback can still resolve it.
        throw new UpayError(
          "UNRECOGNIZED_RESPONSE",
          `Upay query outcome "${record.outcome}" is not a confirmation — refusing to confirm.`,
        );
      }
      if (record.currency !== null && record.currency.toUpperCase() !== "BDT") {
        throw new UpayError(
          "AMOUNT_MISMATCH",
          "Upay query currency is not BDT — refusing to confirm.",
        );
      }
      if (record.amountPoisha === null || record.amountPoisha !== attempt.amountPoisha) {
        // Tampered or partial amount: NEVER confirm, NEVER mark paid.
        // The attempt stays UNPAID for staff review.
        throw new UpayError(
          "AMOUNT_MISMATCH",
          "Upay queried amount does not equal the order amount — refusing to confirm.",
        );
      }
      if (record.gatewayTransactionId !== null) {
        await store.setGatewayResponseRef(attempt.attemptId, record.gatewayTransactionId);
      }
      await store.applyStatus(attempt.attemptId, "PAID", record.amountPoisha);
      await store.markOrderPayment(attempt.orderId, {
        paymentStatus: "PAID",
        source: "gateway_verify",
        reference: attempt.attemptId,
      });
      return { status: "PAID", paidPoisha: record.amountPoisha };
    },

    async refund(_input: PaymentRefundInput) {
      // No Upay merchant refund operation is grounded in any public
      // source — refuse honestly (the Nagad rule) instead of
      // inventing a call. Refunds are issued from the Upay merchant
      // panel and recorded in the refund workbench.
      void _input;
      throw new UpayError(
        "REFUND_UNSUPPORTED",
        "Upay documents no merchant refund API call this adapter can make — issue the refund from the Upay merchant panel and record it in the refund workbench.",
      );
    },

    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // No signed Upay webhook is grounded; the server-to-server
      // channel is the IPN POST, which the IPN route drives through
      // verify() (query-by-invoice) — the exact analogue of the
      // SSLCommerz rule. Returning false prevents an unverified
      // direct application.
      void _verification;
      return false;
    },
  };
}
