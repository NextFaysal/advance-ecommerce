/**
 * SSLCommerz LIVE adapter — ADV-4 (doc 22).
 *
 * A REAL PaymentGateway (src/integrations/payment.ts) for SSLCommerz,
 * the hosted card/mobile-banking gateway. Credentials (store id +
 * store password) are constructor inputs resolved from the encrypted
 * Admin Settings store by src/payments/live-gateways.ts — they are
 * never logged and never appear in an error message.
 *
 * Flow:
 *  - initiate(): POST /gwprocess/v4/api.php (form) -> GatewayPageURL.
 *    Our PaymentAttempt id IS the SSLCommerz tran_id (unique, <= 30
 *    chars), so every later callback resolves to exactly one attempt.
 *  - verify(): the ONLY confirmation path. Called by the callback /
 *    IPN routes with the val_id the gateway issued. It calls the
 *    validation API (val_id -> status/tran_id/amount) and confirms
 *    ONLY when the validated record matches the persisted attempt:
 *    status VALID/VALIDATED, tran_id == attempt id, and the amount —
 *    parsed from the BDT decimal string into integer poisha — equals
 *    the attempt amount exactly. The browser POST body is NEVER
 *    trusted on its own; it only supplies the val_id.
 *  - refund(): the merchant validation endpoint doubles as the refund
 *    API (bank_tran_id + refund_amount + refund_remarks + refe_id).
 *    bank_tran_id is captured from the validation response at verify
 *    time and parked in PaymentAttempt.gatewayResponseRef; a refund
 *    without it is refused, never guessed. SSLCommerz refunds settle
 *    asynchronously after acceptance — the local Refund row records
 *    the accepted initiation, mirroring the sandbox refund contract.
 *
 * Confirmation writes go through the shared funnel
 * (src/payments/live-store.ts -> sandbox db-store applyAttemptStatus /
 * recordRefund + orders markOrderPayment) — the same path the sandbox
 * gateway and the verified webhook use. No second state machine.
 *
 * Failure honesty: a gateway rejection, an unrecognised response, or
 * an amount/tran mismatch THROWS SslCommerzError (or returns FAILED
 * where the interface's verify contract expects a status) — nothing
 * here reports a payment that was not validated.
 *
 * Mode: "sandbox" points at SSLCommerz's own sandbox environment
 * (test store credentials), "live" at the production host. This is
 * NOT the app's simulated sandbox gateway — initiation here always
 * makes a real HTTP call to SSLCommerz.
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
  liveRefundRef,
  poishaToBdtDecimal,
  prismaLivePaymentStore,
  type LivePaymentStore,
} from "../payments/live-store";

export const SSLCOMMERZ_BASE_URLS = {
  sandbox: "https://sandbox.sslcommerz.com",
  live: "https://securepay.sslcommerz.com",
} as const;

export type SslCommerzMode = keyof typeof SSLCOMMERZ_BASE_URLS;

export class SslCommerzError extends Error {
  /** NOT_CONFIGURED | INVALID_INPUT | NETWORK | HTTP_<status> |
   *  INIT_REJECTED | VALIDATION_REJECTED | AMOUNT_MISMATCH |
   *  TRAN_MISMATCH | REFUND_REJECTED | REFUND_REFERENCE_MISSING |
   *  UNRECOGNIZED_RESPONSE | ATTEMPT_NOT_FOUND */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SslCommerzError";
    this.code = code;
  }
}

export type SslFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SslCommerzCredentials {
  storeId: string;
  storePassword: string;
}

export interface SslCommerzAdapterOptions {
  mode: SslCommerzMode;
  fetchFn?: SslFetch;
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

/**
 * The form body POSTed to /gwprocess/v4/api.php. Exported for the
 * smoke. success/fail/cancel/ipn URLs are derived from the app base
 * (input.returnUrl's origin): the callback route distinguishes the
 * outcome by the `result` query parameter, and ALL of them still
 * require validation-API confirmation before money is believed.
 */
export function buildSslCommerzInitPayload(
  credentials: SslCommerzCredentials,
  input: PaymentInitiateInput,
  tranId: string,
): Record<string, string> {
  const origin = new URL(input.returnUrl).origin;
  const callback = `${origin}/api/v1/public/payments/sslcommerz/callback`;
  return {
    store_id: credentials.storeId,
    store_passwd: credentials.storePassword,
    total_amount: poishaToBdtDecimal(input.amountPoisha),
    currency: "BDT",
    tran_id: tranId,
    success_url: `${callback}?result=success`,
    fail_url: `${callback}?result=fail`,
    cancel_url: `${callback}?result=cancel`,
    ipn_url: `${origin}/api/v1/public/payments/sslcommerz/ipn`,
    shipping_method: "NO",
    product_name: "Order payment",
    product_category: "general",
    product_profile: "general",
    cus_name: "Online Customer",
    cus_email: "",
    cus_add1: "Dhaka",
    cus_city: "Dhaka",
    cus_country: "Bangladesh",
    cus_phone: input.customerPhone,
    // Pass-through: echoed back on callbacks; the attempt id is the
    // authoritative key, this is only a debugging aid.
    value_a: tranId,
  };
}

interface SslValidationRecord {
  status: string;
  tranId: string;
  /** Integer poisha parsed exactly from the BDT decimal string. */
  amountPoisha: number | null;
  currency: string | null;
  bankTranId: string | null;
}

/** Parse a validation-API response body. Exported for the smoke. */
export function parseSslValidationResponse(data: unknown): SslValidationRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const status = typeof row.status === "string" ? row.status : "";
  const tranId = typeof row.tran_id === "string" ? row.tran_id : "";
  if (status === "" || tranId === "") return null;
  const amountRaw = row.amount;
  const amountPoisha =
    typeof amountRaw === "string" || typeof amountRaw === "number"
      ? bdtDecimalToPoisha(amountRaw)
      : null;
  const currencyRaw = row.currency_type ?? row.currency;
  return {
    status,
    tranId,
    amountPoisha,
    currency: typeof currencyRaw === "string" ? currencyRaw : null,
    bankTranId: typeof row.bank_tran_id === "string" && row.bank_tran_id !== "" ? row.bank_tran_id : null,
  };
}

export function createSslCommerzGateway(
  credentials: SslCommerzCredentials,
  options: SslCommerzAdapterOptions,
): PaymentGateway {
  if (credentials.storeId.trim() === "" || credentials.storePassword.trim() === "") {
    throw new SslCommerzError(
      "NOT_CONFIGURED",
      "SSLCommerz is not configured — store_id / store_password missing from Settings.",
    );
  }
  const baseUrl = SSLCOMMERZ_BASE_URLS[options.mode];
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const store = options.store ?? prismaLivePaymentStore;

  const config: ProviderConfig = {
    provider: "sslcommerz",
    enabled: true,
    mode: options.mode,
    status: "configured",
    // Reference only — the credential values never travel in config.
    credentialRef: "settings:payment.sslcommerz",
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
      // Network errors can embed the URL (which carries no secret for
      // init, but the validation/refund query strings DO carry the
      // store password) — report the failure class only, never the URL.
      throw new SslCommerzError("NETWORK", "SSLCommerz request failed (network/timeout).");
    }
    if (!response.ok) {
      throw new SslCommerzError(`HTTP_${response.status}`, `SSLCommerz request failed (HTTP ${response.status}).`);
    }
    return response.json().catch(() => null);
  }

  /** The validation API call shared by verify() and the smoke. */
  async function validateWithGateway(valId: string): Promise<SslValidationRecord> {
    const query = new URLSearchParams({
      val_id: valId,
      store_id: credentials.storeId,
      store_passwd: credentials.storePassword,
      format: "json",
    });
    const data = await callApi(`/validator/api/validationserverAPI.php?${query.toString()}`, {
      method: "GET",
    });
    const record = parseSslValidationResponse(data);
    if (record === null) {
      throw new SslCommerzError(
        "UNRECOGNIZED_RESPONSE",
        "SSLCommerz validation response had no recognisable status/tran_id.",
      );
    }
    return record;
  }

  return {
    method: "sslcommerz",
    config,

    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) {
        throw new SslCommerzError("INVALID_INPUT", "Invalid SSLCommerz initiate input.");
      }
      const attemptId = liveAttemptId("sslcommerz", parsed.data.idempotencyKey);
      const attempt = await store.getOrCreateAttempt({
        method: "sslcommerz",
        orderRef: parsed.data.orderId,
        amountPoisha: parsed.data.amountPoisha,
        attemptId,
        // tran_id == attempt id: unique per initiation, <= 30 chars.
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
      const payload = buildSslCommerzInitPayload(credentials, parsed.data, attemptId);
      const data = (await callApi("/gwprocess/v4/api.php", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(payload).toString(),
      })) as Record<string, unknown> | null;
      const gatewayPageUrl =
        data && typeof data.GatewayPageURL === "string" ? data.GatewayPageURL : "";
      if (!data || data.status !== "SUCCESS" || gatewayPageUrl === "") {
        const reason =
          data && typeof data.failedreason === "string" && data.failedreason !== ""
            ? data.failedreason
            : "no GatewayPageURL returned";
        throw new SslCommerzError(
          "INIT_REJECTED",
          `SSLCommerz refused the session (${reason}).`,
        );
      }
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: gatewayPageUrl,
        gatewayTransactionId: attempt.gatewayTransactionId,
        status: attempt.status,
      };
    },

    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      const attempt = await store.findAttemptById(input.paymentAttemptId);
      if (!attempt || attempt.method !== "sslcommerz") {
        throw new SslCommerzError("ATTEMPT_NOT_FOUND", "SSLCommerz attempt not found.");
      }
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        // Idempotent re-verify: re-running the order funnel self-heals
        // an order whose earlier funnel call was missed (sandbox parity).
        await store.markOrderPayment(attempt.orderId, {
          paymentStatus: attempt.status,
          source: "gateway_verify",
          reference: attempt.attemptId,
        });
        return { status: attempt.status, paidPoisha: attempt.paidPoisha };
      }
      // input.gatewayTransactionId carries the val_id (the callback /
      // IPN route passes it through) — the gateway's own validation
      // record is the only evidence accepted from here on.
      const record = await validateWithGateway(input.gatewayTransactionId);
      if (record.tranId !== attempt.attemptId) {
        await store.applyStatus(attempt.attemptId, "FAILED");
        throw new SslCommerzError(
          "TRAN_MISMATCH",
          "SSLCommerz validation tran_id does not match the payment attempt.",
        );
      }
      const validatedStatus = record.status.toUpperCase();
      if (validatedStatus !== "VALID" && validatedStatus !== "VALIDATED") {
        await store.applyStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (record.currency !== null && record.currency.toUpperCase() !== "BDT") {
        throw new SslCommerzError(
          "AMOUNT_MISMATCH",
          "SSLCommerz validation currency is not BDT — refusing to confirm.",
        );
      }
      if (record.amountPoisha === null || record.amountPoisha !== attempt.amountPoisha) {
        // Tampered or partial amount: NEVER confirm, NEVER mark paid.
        // The attempt stays UNPAID for staff review (not FAILED — the
        // gateway may yet deliver a correct IPN for the same val_id).
        throw new SslCommerzError(
          "AMOUNT_MISMATCH",
          "SSLCommerz validated amount does not equal the order amount — refusing to confirm.",
        );
      }
      if (record.bankTranId !== null) {
        // Park the bank transaction id: the refund API keys off it.
        await store.setGatewayResponseRef(attempt.attemptId, record.bankTranId);
      }
      await store.applyStatus(attempt.attemptId, "PAID", record.amountPoisha);
      await store.markOrderPayment(attempt.orderId, {
        paymentStatus: "PAID",
        source: "gateway_verify",
        reference: attempt.attemptId,
      });
      return { status: "PAID", paidPoisha: record.amountPoisha };
    },

    async refund(input: PaymentRefundInput) {
      const amount = z.number().int().positive().parse(input.amountPoisha);
      const attempt = await store.findAttemptById(input.paymentId);
      if (!attempt || attempt.method !== "sslcommerz") {
        throw new SslCommerzError("ATTEMPT_NOT_FOUND", "SSLCommerz payment not found.");
      }
      if (attempt.paidPoisha === 0) throw new Error("Cannot refund an unpaid payment.");
      if (attempt.refundedPoisha + amount > attempt.paidPoisha) {
        throw new Error("Refund exceeds paid amount.");
      }
      const bankTranId = attempt.gatewayResponseRef;
      if (bankTranId === null || bankTranId === "") {
        throw new SslCommerzError(
          "REFUND_REFERENCE_MISSING",
          "No bank_tran_id was captured for this payment (validation never completed) — refund must be issued from the SSLCommerz merchant panel.",
        );
      }
      const query = new URLSearchParams({
        store_id: credentials.storeId,
        store_passwd: credentials.storePassword,
        bank_tran_id: bankTranId,
        refund_amount: poishaToBdtDecimal(amount),
        refund_remarks: input.reason.slice(0, 100),
        refe_id: liveRefundRef(attempt.attemptId, input.idempotencyKey),
      });
      const data = (await callApi(
        `/validator/api/merchantTransIDvalidationAPI.php?${query.toString()}`,
        { method: "GET" },
      )) as Record<string, unknown> | null;
      const accepted =
        data !== null &&
        (data.status === "success" || data.status === "SUCCESS") &&
        typeof data.errorReason !== "string";
      if (!accepted) {
        throw new SslCommerzError(
          "REFUND_REJECTED",
          "SSLCommerz did not accept the refund initiation.",
        );
      }
      const result = await store.recordRefund({
        attemptId: attempt.attemptId,
        amountPoisha: amount,
        reason: input.reason,
      });
      if (!result) {
        throw new SslCommerzError("ATTEMPT_NOT_FOUND", "SSLCommerz payment not found.");
      }
      await store.markOrderPayment(attempt.orderId, {
        paymentStatus: result.status,
        source: "gateway_refund",
        reference: attempt.attemptId,
      });
      return { status: result.status, refundedPoisha: result.refundedPoisha };
    },

    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // SSLCommerz has no signed webhook; its server-to-server channel
      // is the IPN POST, which the IPN route drives through verify()
      // (validation API) — the exact analogue of the sandbox rule that
      // routes go through processWebhook(). Returning false here
      // prevents an unverified direct application.
      void _verification;
      return false;
    },
  };
}
