/**
 * Nagad LIVE adapter — ADV-4 (doc 22).
 *
 * A REAL PaymentGateway (src/integrations/payment.ts) for the Nagad
 * Payment Gateway checkout API (X-KM-Api-Version v-0.2.0):
 *
 *  1. initialize — POST {base}/check-out/initialize/{merchantId}/{orderId}
 *     The sensitive payload {merchantId, datetime, orderId,
 *     currencyCode "050", amount, challenge} is RSA-encrypted with
 *     NAGAD's public key (PKCS#1 v1.5) and the plaintext JSON is
 *     RSA-SHA256-signed with the MERCHANT private key. The response's
 *     sensitiveData is encrypted back with the merchant public key;
 *     decrypting it (merchant private key) yields the
 *     paymentReferenceId the customer checkout is keyed by. If the
 *     envelope itself carries paymentReferenceId / callBackUrl (some
 *     gateway builds do), those are accepted as a fallback — the
 *     reference is never invented.
 *  2. checkout — the customer is redirected to
 *     {base}/check-out/{paymentReferenceId} (or the gateway-provided
 *     callBackUrl). Nagad then redirects the browser to our
 *     merchantCallbackURL with payment_ref_id in the query.
 *  3. verify — GET {base}/verify/payment/{paymentReferenceId}. The
 *     browser callback's `status` parameter is NEVER trusted: only
 *     this server-side record confirms, and only when status is
 *     "Success", the orderId equals our merchant order id, and the
 *     amount (BDT decimal -> integer poisha) equals the attempt
 *     amount exactly.
 *
 * Credentials are constructor inputs resolved from the encrypted
 * Admin Settings store by src/payments/live-gateways.ts:
 *   payment.nagad.merchant_id          (merchant id issued by Nagad)
 *   payment.nagad.account_number       (merchant Nagad MSISDN)
 *   payment.nagad.merchant_private_key (PEM, RSA private key)
 *   payment.nagad.nagad_public_key     (PEM, Nagad's RSA public key)
 * Keys live only in this closure — never logged, never in an error.
 *
 * Confirmation writes go through the shared funnel
 * (src/payments/live-store.ts -> sandbox db-store applyAttemptStatus /
 * recordRefund + orders markOrderPayment) — the same path the sandbox
 * gateway uses. No second state machine.
 *
 * REFUND: the Nagad checkout API (v-0.2.0) documents no merchant
 * refund endpoint, so refund() throws REFUND_UNSUPPORTED rather than
 * inventing a call — refunds for Nagad payments are issued from the
 * Nagad merchant panel and recorded in the refund workbench until
 * Nagad documents an API.
 *
 * Final live verification happens when Nazmul connects a real Nagad
 * merchant account (doc 22 ADV-4 acceptance: one real payment + one
 * refund attempt on production); until then the adapter is verified
 * against the documented contract with mocked HTTP + real RSA keys.
 */
import {
  createSign,
  createVerify,
  privateDecrypt,
  publicEncrypt,
  randomInt,
  constants as cryptoConstants,
} from "node:crypto";
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

export const NAGAD_BASE_URLS = {
  sandbox: "http://sandbox.mynagad.com:10080/api/dfs",
  live: "https://api.mynagad.com/api/dfs",
} as const;

export type NagadMode = keyof typeof NAGAD_BASE_URLS;

export class NagadError extends Error {
  /** NOT_CONFIGURED | INVALID_INPUT | NETWORK | HTTP_<status> |
   *  INIT_REJECTED | VERIFY_REJECTED | AMOUNT_MISMATCH |
   *  ORDER_MISMATCH | REF_MISMATCH | REFUND_UNSUPPORTED |
   *  UNRECOGNIZED_RESPONSE | ATTEMPT_NOT_FOUND | CRYPTO */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "NagadError";
    this.code = code;
  }
}

export type NagadFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface NagadCredentials {
  merchantId: string;
  /** Merchant Nagad account number (MSISDN) sent as accountNumber. */
  accountNumber: string;
  /** PEM-encoded RSA private key of the merchant. */
  merchantPrivateKeyPem: string;
  /** PEM-encoded RSA public key of Nagad. */
  nagadPublicKeyPem: string;
}

export interface NagadAdapterOptions {
  mode: NagadMode;
  fetchFn?: NagadFetch;
  timeoutMs?: number;
  store?: LivePaymentStore;
  /** Sent as X-KM-IP-V4 (the gateway expects an IPv4 address; the
   *  merchant server's public IP in production). */
  clientIp?: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const NAGAD_CURRENCY_CODE = "050"; // ISO 4217 numeric for BDT.

/* ------------------------------------------------------------------ */
/* RSA + formatting primitives (exported for the smoke)                */
/* ------------------------------------------------------------------ */

/** RSA-encrypt the sensitive-data JSON with Nagad's public key. */
export function encryptNagadSensitiveData(plainJson: string, nagadPublicKeyPem: string): string {
  try {
    return publicEncrypt(
      { key: nagadPublicKeyPem, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(plainJson, "utf8"),
    ).toString("base64");
  } catch {
    throw new NagadError("CRYPTO", "Nagad sensitive-data encryption failed (check the Nagad public key in Settings).");
  }
}

/** RSA-decrypt a gateway sensitive-data block with OUR private key. */
export function decryptNagadSensitiveData(encoded: string, merchantPrivateKeyPem: string): string {
  try {
    return privateDecrypt(
      { key: merchantPrivateKeyPem, padding: cryptoConstants.RSA_PKCS1_PADDING },
      Buffer.from(encoded, "base64"),
    ).toString("utf8");
  } catch {
    throw new NagadError("CRYPTO", "Nagad response decryption failed (check the merchant private key in Settings).");
  }
}

/** RSA-SHA256 (PKCS#1 v1.5) signature over the plaintext JSON. */
export function signNagadData(plainJson: string, merchantPrivateKeyPem: string): string {
  try {
    const signer = createSign("RSA-SHA256");
    signer.update(plainJson, "utf8");
    signer.end();
    return signer.sign(merchantPrivateKeyPem).toString("base64");
  } catch {
    throw new NagadError("CRYPTO", "Nagad request signing failed (check the merchant private key in Settings).");
  }
}

/** Verify a gateway signature over a plaintext payload. */
export function verifyNagadSignature(
  plainJson: string,
  signatureBase64: string,
  nagadPublicKeyPem: string,
): boolean {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(plainJson, "utf8");
    verifier.end();
    return verifier.verify(nagadPublicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

const CHALLENGE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Nagad expects a fresh alphanumeric challenge per initialize. */
export function generateNagadChallenge(length = 40): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CHALLENGE_ALPHABET[randomInt(CHALLENGE_ALPHABET.length)];
  return out;
}

/** yyyyMMddHHmmss in Asia/Dhaka (the gateway's expected clock). */
export function nagadDateTime(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}${get("hour")}${get("minute")}${get("second")}`;
}

/** The initialize sensitive-data plaintext object. Exported for the smoke. */
export function buildNagadSensitiveData(
  credentials: NagadCredentials,
  input: { orderId: string; amountPoisha: number; dateTime: string; challenge: string },
): Record<string, string> {
  return {
    merchantId: credentials.merchantId,
    datetime: input.dateTime,
    orderId: input.orderId,
    currencyCode: NAGAD_CURRENCY_CODE,
    amount: poishaToBdtDecimal(input.amountPoisha),
    challenge: input.challenge,
  };
}

interface NagadVerifyRecord {
  status: string;
  orderId: string | null;
  amountPoisha: number | null;
  paymentRefId: string | null;
  issuerPaymentRefNo: string | null;
}

/** Parse a verify-payment response body. Exported for the smoke. */
export function parseNagadVerifyResponse(data: unknown): NagadVerifyRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const status = typeof row.status === "string" ? row.status : "";
  if (status === "") return null;
  const amountRaw = row.amount;
  return {
    status,
    orderId: typeof row.orderId === "string" ? row.orderId : null,
    amountPoisha:
      typeof amountRaw === "string" || typeof amountRaw === "number"
        ? bdtDecimalToPoisha(amountRaw)
        : null,
    paymentRefId: typeof row.paymentRefId === "string" ? row.paymentRefId : null,
    issuerPaymentRefNo:
      typeof row.issuerPaymentRefNo === "string" ? row.issuerPaymentRefNo : null,
  };
}

const initiateSchema = z.object({
  orderId: z.string().min(1),
  amountPoisha: z.number().int().positive(),
  customerPhone: z.string().min(11).max(15),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
  idempotencyKey: z.string().min(1),
});

export function createNagadGateway(
  credentials: NagadCredentials,
  options: NagadAdapterOptions,
): PaymentGateway {
  if (
    credentials.merchantId.trim() === "" ||
    credentials.accountNumber.trim() === "" ||
    credentials.merchantPrivateKeyPem.trim() === "" ||
    credentials.nagadPublicKeyPem.trim() === ""
  ) {
    throw new NagadError(
      "NOT_CONFIGURED",
      "Nagad is not configured — merchant_id / account_number / merchant_private_key / nagad_public_key missing from Settings.",
    );
  }
  const baseUrl = NAGAD_BASE_URLS[options.mode];
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const store = options.store ?? prismaLivePaymentStore;
  const clientIp = options.clientIp ?? "127.0.0.1";

  const config: ProviderConfig = {
    provider: "nagad",
    enabled: true,
    mode: options.mode,
    status: "configured",
    // Reference only — the credential values never travel in config.
    credentialRef: "settings:payment.nagad",
    lastTestedAt: null,
    lastError: null,
  };

  function kmHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-KM-Api-Version": "v-0.2.0",
      "X-KM-IP-V4": clientIp,
      "X-KM-Client-Type": "PC_WEB",
    };
  }

  async function callApi(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new NagadError("NETWORK", "Nagad request failed (network/timeout).");
    }
    if (!response.ok) {
      throw new NagadError(`HTTP_${response.status}`, `Nagad request failed (HTTP ${response.status}).`);
    }
    return response.json().catch(() => null);
  }

  function checkoutUrl(paymentReferenceId: string, callBackUrl: string | null): string {
    return callBackUrl ?? `${baseUrl}/check-out/${paymentReferenceId}`;
  }

  return {
    method: "nagad",
    config,

    async initiate(input: PaymentInitiateInput): Promise<PaymentInitiateResult> {
      const parsed = initiateSchema.safeParse(input);
      if (!parsed.success) {
        throw new NagadError("INVALID_INPUT", "Invalid Nagad initiate input.");
      }
      const attemptId = liveAttemptId("nagad", parsed.data.idempotencyKey);
      const attempt = await store.getOrCreateAttempt({
        method: "nagad",
        orderRef: parsed.data.orderId,
        amountPoisha: parsed.data.amountPoisha,
        attemptId,
        // The Nagad "orderId" (merchant invoice reference) IS our
        // attempt id — the verify record must echo it back.
        gatewayTransactionId: attemptId,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      if (attempt.gatewayResponseRef !== null && attempt.gatewayResponseRef !== "") {
        // Replay after a successful initialize: the checkout session
        // already exists — hand back its URL, never re-initialize
        // (a second initialize for the same orderId is rejected).
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl:
            attempt.status === "UNPAID"
              ? checkoutUrl(attempt.gatewayResponseRef, null)
              : null,
          gatewayTransactionId: attempt.gatewayTransactionId,
          status: attempt.status,
        };
      }
      if (attempt.status !== "UNPAID") {
        return {
          paymentAttemptId: attempt.attemptId,
          redirectUrl: null,
          gatewayTransactionId: attempt.gatewayTransactionId,
          status: attempt.status,
        };
      }

      const dateTime = nagadDateTime();
      const sensitive = buildNagadSensitiveData(credentials, {
        orderId: attemptId,
        amountPoisha: parsed.data.amountPoisha,
        dateTime,
        challenge: generateNagadChallenge(),
      });
      const plainJson = JSON.stringify(sensitive);
      const body = {
        accountNumber: credentials.accountNumber,
        dateTime,
        sensitiveData: encryptNagadSensitiveData(plainJson, credentials.nagadPublicKeyPem),
        signature: signNagadData(plainJson, credentials.merchantPrivateKeyPem),
      };
      const data = (await callApi(
        `/check-out/initialize/${encodeURIComponent(credentials.merchantId)}/${encodeURIComponent(attemptId)}`,
        { method: "POST", headers: kmHeaders(), body: JSON.stringify(body) },
      )) as Record<string, unknown> | null;
      if (!data || typeof data.result !== "string" || data.result.toUpperCase() !== "SUCCESS") {
        throw new NagadError("INIT_REJECTED", "Nagad refused the checkout initialization.");
      }

      // The payment reference comes from the decrypted sensitiveData;
      // some gateway builds also expose it on the plain envelope.
      let paymentReferenceId: string | null = null;
      let callBackUrl: string | null = null;
      if (typeof data.sensitiveData === "string" && data.sensitiveData !== "") {
        const decrypted = decryptNagadSensitiveData(data.sensitiveData, credentials.merchantPrivateKeyPem);
        try {
          const inner = JSON.parse(decrypted) as Record<string, unknown>;
          if (typeof inner.paymentReferenceId === "string") paymentReferenceId = inner.paymentReferenceId;
          if (typeof inner.callBackUrl === "string") callBackUrl = inner.callBackUrl;
        } catch {
          throw new NagadError("UNRECOGNIZED_RESPONSE", "Nagad initialize response sensitiveData was not JSON.");
        }
      }
      if (paymentReferenceId === null && typeof data.paymentReferenceId === "string") {
        paymentReferenceId = data.paymentReferenceId;
      }
      if (callBackUrl === null && typeof data.callBackUrl === "string") {
        callBackUrl = data.callBackUrl;
      }
      if (paymentReferenceId === null || paymentReferenceId === "") {
        throw new NagadError(
          "UNRECOGNIZED_RESPONSE",
          "Nagad initialize response carried no paymentReferenceId.",
        );
      }
      await store.setGatewayResponseRef(attempt.attemptId, paymentReferenceId);
      return {
        paymentAttemptId: attempt.attemptId,
        redirectUrl: checkoutUrl(paymentReferenceId, callBackUrl),
        gatewayTransactionId: attempt.gatewayTransactionId,
        status: attempt.status,
      };
    },

    async verify(input: PaymentVerifyInput): Promise<PaymentVerifyResult> {
      const attempt = await store.findAttemptById(input.paymentAttemptId);
      if (!attempt || attempt.method !== "nagad") {
        throw new NagadError("ATTEMPT_NOT_FOUND", "Nagad attempt not found.");
      }
      if (attempt.status === "PAID" || attempt.status === "PARTIALLY_REFUNDED" || attempt.status === "REFUNDED") {
        await store.markOrderPayment(attempt.orderId, {
          paymentStatus: attempt.status,
          source: "gateway_verify",
          reference: attempt.attemptId,
        });
        return { status: attempt.status, paidPoisha: attempt.paidPoisha };
      }
      // input.gatewayTransactionId carries the paymentReferenceId the
      // callback received — it must be the reference WE parked at
      // initialize time for this attempt.
      const paymentReferenceId = attempt.gatewayResponseRef;
      if (
        paymentReferenceId === null ||
        paymentReferenceId === "" ||
        input.gatewayTransactionId !== paymentReferenceId
      ) {
        await store.applyStatus(attempt.attemptId, "FAILED");
        throw new NagadError(
          "REF_MISMATCH",
          "Nagad payment reference does not match the payment attempt.",
        );
      }
      const data = await callApi(`/verify/payment/${encodeURIComponent(paymentReferenceId)}`, {
        method: "GET",
        headers: kmHeaders(),
      });
      const record = parseNagadVerifyResponse(data);
      if (record === null) {
        throw new NagadError("UNRECOGNIZED_RESPONSE", "Nagad verify response had no recognisable status.");
      }
      if (record.status !== "Success") {
        // Failed / Cancelled / Abandoned (or any non-success terminal
        // state the gateway reports): the attempt is resolved FAILED.
        await store.applyStatus(attempt.attemptId, "FAILED");
        return { status: "FAILED", paidPoisha: 0 };
      }
      if (record.orderId !== null && record.orderId !== attempt.gatewayTransactionId) {
        throw new NagadError(
          "ORDER_MISMATCH",
          "Nagad verify record orderId does not match the payment attempt — refusing to confirm.",
        );
      }
      if (record.amountPoisha === null || record.amountPoisha !== attempt.amountPoisha) {
        // Tampered or partial amount: NEVER confirm, attempt stays
        // UNPAID for staff review.
        throw new NagadError(
          "AMOUNT_MISMATCH",
          "Nagad verified amount does not equal the order amount — refusing to confirm.",
        );
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
      // No merchant refund endpoint is documented in the Nagad
      // checkout API (v-0.2.0) — refuse explicitly instead of
      // inventing a call that would silently do nothing.
      void _input;
      throw new NagadError(
        "REFUND_UNSUPPORTED",
        "Nagad documents no refund API for this integration — issue the refund from the Nagad merchant panel and record it in the refund workbench.",
      );
    },

    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // Nagad's server confirmation channel is the verify-payment API,
      // driven by the callback route through verify() — there is no
      // signed webhook to apply here (sandbox parity: direct webhook
      // application returns false).
      void _verification;
      return false;
    },
  };
}
