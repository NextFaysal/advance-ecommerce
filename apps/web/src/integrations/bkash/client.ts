/**
 * bKash tokenized-checkout API client — ADV-4 (doc 22), first live
 * payment adapter in the codebase.
 *
 * Pure HTTP layer: no DB, no Settings imports. Credentials are passed
 * in by the resolver (src/integrations/bkash/resolver.ts) from the
 * encrypted Settings store and are NEVER logged, returned, or embedded
 * in an error message — errors carry only the provider's statusCode /
 * statusMessage and our own machine codes.
 *
 * API shape (bKash Tokenized Checkout v1.2.0-beta):
 *   POST {base}/tokenized/checkout/token/grant   (headers: username,
 *        password; body: app_key, app_secret) -> { id_token, expires_in }
 *   POST {base}/tokenized/checkout/create        (headers: Authorization:
 *        <id_token>, X-APP-Key) -> { paymentID, bkashURL, statusCode }
 *   POST {base}/tokenized/checkout/execute       body { paymentID }
 *        -> { trxID, transactionStatus: "Completed", amount, ... }
 *   POST {base}/tokenized/checkout/payment/status body { paymentID }
 *   POST {base}/tokenized/checkout/payment/refund body { paymentID,
 *        amount, trxID, sku, reason } -> { refundTrxID, transactionStatus }
 *   POST {base}/tokenized/checkout/payment/refund/status
 *        body { paymentID, trxID: <refundTrxID> }
 * Every response carries statusCode "0000" on success; anything else is
 * a provider rejection surfaced as BkashProviderError(BKASH_<code>).
 *
 * Base URLs: bKash runs its own sandbox environment; `mode` in Settings
 * picks which one the client talks to (resolver's job). The app's own
 * simulated sandbox checkout (src/integrations/sandbox) is a different
 * thing and stays untouched.
 *
 * Money: internal amounts are integer poisha everywhere. Conversion to
 * the gateway's BDT decimal happens HERE, at the boundary only, with
 * integer math (no float money): 191000 poisha -> "1910.00".
 */
import { z } from "zod";

export const BKASH_BASE_URLS = {
  live: "https://tokenized.payments.bka.sh/v1.2.0-beta",
  sandbox: "https://tokenized.sandbox.bka.sh/v1.2.0-beta",
} as const;

export type BkashEnvironment = keyof typeof BKASH_BASE_URLS;

/** Merchant credentials, from encrypted Settings payment.bkash.* —
 *  username / password / app_key / app_secret. Values never leave the
 *  server and are never placed in errors or logs. */
export interface BkashCredentials {
  username: string;
  password: string;
  appKey: string;
  appSecret: string;
}

export type BkashFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface BkashAdapterOptions {
  fetchFn?: BkashFetch;
  timeoutMs?: number;
  /** Injectable clock (ms epoch) — token-cache tests. */
  now?: () => number;
}

export class BkashProviderError extends Error {
  /** Machine code: NOT_CONFIGURED | NETWORK | HTTP_<status> |
   *  BKASH_<provider statusCode> | UNRECOGNIZED_RESPONSE |
   *  AMOUNT_MISMATCH | REFUND_NOT_COMPLETED. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BkashProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Money at the gateway boundary (integer math only)                   */
/* ------------------------------------------------------------------ */

/** 191000 -> "1910.00"; 5 -> "0.05". Poisha must be a non-negative int. */
export function poishaToBdtString(poisha: number): string {
  if (!Number.isInteger(poisha) || poisha < 0) {
    throw new BkashProviderError("INVALID_AMOUNT", "Amount must be a non-negative integer (poisha).");
  }
  const taka = Math.floor(poisha / 100);
  const rem = poisha % 100;
  return `${taka}.${String(rem).padStart(2, "0")}`;
}

/** "1910.00" -> 191000; "0.05" -> 5; 1910.5 -> 191050. Parses via the
 *  decimal string so no float ever represents money. */
export function bdtToPoisha(value: string | number): number {
  const text = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new BkashProviderError(
      "UNRECOGNIZED_RESPONSE",
      `bKash returned an unparseable amount: ${JSON.stringify(text)}.`,
    );
  }
  const taka = Number.parseInt(match[1] as string, 10);
  const frac = Number.parseInt(((match[2] as string | undefined) ?? "").padEnd(2, "0") || "0", 10);
  return taka * 100 + frac;
}

/* ------------------------------------------------------------------ */
/* Response shapes                                                     */
/* ------------------------------------------------------------------ */

const grantSchema = z.object({
  statusCode: z.string(),
  statusMessage: z.string().optional(),
  id_token: z.string().min(1),
  expires_in: z.coerce.number().positive().optional(),
});

const createSchema = z.object({
  statusCode: z.string(),
  statusMessage: z.string().optional(),
  paymentID: z.string().min(1),
  bkashURL: z.string().url(),
});

const executionSchema = z.object({
  statusCode: z.string(),
  statusMessage: z.string().optional(),
  paymentID: z.string().min(1),
  trxID: z.string().min(1).nullable().optional(),
  transactionStatus: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().optional(),
  customerMsisdn: z.string().optional(),
});

const refundSchema = z.object({
  statusCode: z.string(),
  statusMessage: z.string().optional(),
  paymentID: z.string().min(1).optional(),
  refundTrxID: z.string().min(1),
  transactionStatus: z.string().min(1),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().optional(),
});

export interface BkashExecution {
  paymentID: string;
  trxID: string | null;
  /** Provider vocabulary verbatim, e.g. "Completed" | "Cancelled" | "Failed". */
  transactionStatus: string;
  amountPoisha: number;
  currency: string | null;
  customerMsisdn: string | null;
}

export interface BkashRefundResult {
  refundTrxID: string;
  transactionStatus: string;
  amountPoisha: number;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

const DEFAULT_TIMEOUT_MS = 20_000;
/** Refresh the grant token this long before its stated expiry. */
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

export interface BkashClient {
  /** Grant (or return the cached) token — exposed for the Settings
   *  connection probe; normal callers never touch it directly. */
  grantToken(): Promise<{ expiresInSeconds: number }>;
  createPayment(input: {
    amountPoisha: number;
    payerReference: string;
    callbackUrl: string;
    merchantInvoiceNumber: string;
  }): Promise<{ paymentID: string; bkashURL: string }>;
  executePayment(paymentID: string): Promise<BkashExecution>;
  queryPayment(paymentID: string): Promise<BkashExecution>;
  refundPayment(input: {
    paymentID: string;
    trxID: string;
    amountPoisha: number;
    reason: string;
    sku: string;
  }): Promise<BkashRefundResult>;
  queryRefund(input: { paymentID: string; refundTrxID: string }): Promise<BkashRefundResult>;
}

export function createBkashClient(
  credentials: BkashCredentials,
  environment: BkashEnvironment,
  opts: BkashAdapterOptions = {},
): BkashClient {
  const fetchFn = opts.fetchFn ?? (globalThis.fetch as BkashFetch);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const base = BKASH_BASE_URLS[environment];

  for (const [field, value] of Object.entries({
    username: credentials.username,
    password: credentials.password,
    app_key: credentials.appKey,
    app_secret: credentials.appSecret,
  })) {
    if (!value || value.trim() === "") {
      throw new BkashProviderError(
        "NOT_CONFIGURED",
        `bKash credential field "${field}" is missing — see Admin > Settings > Payments.`,
      );
    }
  }

  let cachedToken: { value: string; expiresAt: number } | null = null;

  /** One POST; returns parsed JSON. Throws BkashProviderError on
   *  transport failure or a non-JSON body. The request (which for the
   *  grant call CARRIES credentials) is never echoed into an error. */
  async function post(path: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await fetchFn(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new BkashProviderError("NETWORK", "bKash request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new BkashProviderError(`HTTP_${res.status}`, `bKash request failed with HTTP ${res.status}.`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash returned a non-JSON response.");
    }
  }

  /** bKash signals business failures with HTTP 200 + statusCode != "0000". */
  function assertProviderOk(statusCode: string, statusMessage: string | undefined, action: string): void {
    if (statusCode !== "0000") {
      throw new BkashProviderError(
        `BKASH_${statusCode}`,
        `bKash ${action} rejected (code ${statusCode})${statusMessage ? `: ${statusMessage}` : ""}.`,
      );
    }
  }

  async function grantToken(): Promise<{ expiresInSeconds: number }> {
    const json = await post(
      "/tokenized/checkout/token/grant",
      { username: credentials.username, password: credentials.password },
      { app_key: credentials.appKey, app_secret: credentials.appSecret },
    );
    const parsed = grantSchema.safeParse(json);
    if (!parsed.success) {
      // A failed grant returns an error body without id_token; surface
      // the provider code when the body at least carries one.
      const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
      if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
        assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "token grant");
      }
      throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash token grant returned an unrecognized response.");
    }
    assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "token grant");
    const expiresInSeconds = parsed.data.expires_in ?? 3600;
    cachedToken = {
      value: parsed.data.id_token,
      expiresAt: now() + expiresInSeconds * 1000 - TOKEN_EXPIRY_MARGIN_MS,
    };
    return { expiresInSeconds };
  }

  async function authHeaders(): Promise<Record<string, string>> {
    if (cachedToken === null || cachedToken.expiresAt <= now()) {
      await grantToken();
    }
    return { Authorization: (cachedToken as { value: string }).value, "X-APP-Key": credentials.appKey };
  }

  return {
    grantToken,
    async createPayment(input) {
      const json = await post("/tokenized/checkout/create", await authHeaders(), {
        mode: "0011",
        payerReference: input.payerReference,
        callbackURL: input.callbackUrl,
        amount: poishaToBdtString(input.amountPoisha),
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: input.merchantInvoiceNumber,
      });
      const parsed = createSchema.safeParse(json);
      if (!parsed.success) {
        const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
        if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
          assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "payment create");
        }
        throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash payment create returned an unrecognized response.");
      }
      assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "payment create");
      return { paymentID: parsed.data.paymentID, bkashURL: parsed.data.bkashURL };
    },
    async executePayment(paymentID) {
      const json = await post("/tokenized/checkout/execute", await authHeaders(), { paymentID });
      const parsed = executionSchema.safeParse(json);
      if (!parsed.success) {
        const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
        if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
          assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "payment execute");
        }
        throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash payment execute returned an unrecognized response.");
      }
      assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "payment execute");
      return {
        paymentID: parsed.data.paymentID,
        trxID: parsed.data.trxID ?? null,
        transactionStatus: parsed.data.transactionStatus,
        amountPoisha: bdtToPoisha(parsed.data.amount),
        currency: parsed.data.currency ?? null,
        customerMsisdn: parsed.data.customerMsisdn ?? null,
      };
    },
    async queryPayment(paymentID) {
      const json = await post("/tokenized/checkout/payment/status", await authHeaders(), { paymentID });
      const parsed = executionSchema.safeParse(json);
      if (!parsed.success) {
        const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
        if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
          assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "payment query");
        }
        throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash payment query returned an unrecognized response.");
      }
      assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "payment query");
      return {
        paymentID: parsed.data.paymentID,
        trxID: parsed.data.trxID ?? null,
        transactionStatus: parsed.data.transactionStatus,
        amountPoisha: bdtToPoisha(parsed.data.amount),
        currency: parsed.data.currency ?? null,
        customerMsisdn: parsed.data.customerMsisdn ?? null,
      };
    },
    async refundPayment(input) {
      const json = await post("/tokenized/checkout/payment/refund", await authHeaders(), {
        paymentID: input.paymentID,
        amount: poishaToBdtString(input.amountPoisha),
        trxID: input.trxID,
        sku: input.sku,
        reason: input.reason,
      });
      const parsed = refundSchema.safeParse(json);
      if (!parsed.success) {
        const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
        if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
          assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "refund");
        }
        throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash refund returned an unrecognized response.");
      }
      assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "refund");
      return {
        refundTrxID: parsed.data.refundTrxID,
        transactionStatus: parsed.data.transactionStatus,
        amountPoisha: bdtToPoisha(parsed.data.amount),
      };
    },
    async queryRefund(input) {
      const json = await post("/tokenized/checkout/payment/refund/status", await authHeaders(), {
        paymentID: input.paymentID,
        trxID: input.refundTrxID,
      });
      const parsed = refundSchema.safeParse(json);
      if (!parsed.success) {
        const raw = json as { statusCode?: unknown; statusMessage?: unknown } | null;
        if (raw && typeof raw.statusCode === "string" && raw.statusCode !== "0000") {
          assertProviderOk(raw.statusCode, typeof raw.statusMessage === "string" ? raw.statusMessage : undefined, "refund status");
        }
        throw new BkashProviderError("UNRECOGNIZED_RESPONSE", "bKash refund status returned an unrecognized response.");
      }
      assertProviderOk(parsed.data.statusCode, parsed.data.statusMessage, "refund status");
      return {
        refundTrxID: parsed.data.refundTrxID,
        transactionStatus: parsed.data.transactionStatus,
        amountPoisha: bdtToPoisha(parsed.data.amount),
      };
    },
  };
}
