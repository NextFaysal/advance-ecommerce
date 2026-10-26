/**
 * Upay provider HTTP layer — ADV-4 remainder (doc 22).
 *
 * ⚠️⚠️  UNVERIFIED WIRE FORMAT — READ BEFORE ENABLING LIVE MODE  ⚠️⚠️
 *
 * Everything that touches Upay's actual API — base URLs, endpoint
 * paths, request field names, response field names, the success /
 * failure status vocabulary — lives in THIS ONE FILE, and NONE of it
 * has been verified against Upay's official merchant API
 * documentation. That documentation is NOT public: Upay (UCB Fintech)
 * issues it to onboarded merchants only ("please contact Upay for
 * their API documentation and sandbox access" — the public community
 * integration packages say the same).
 *
 * What IS grounded (public sources, 2026-10-26):
 *  - the credential SET a merchant receives: merchant id, merchant
 *    key, merchant code, plus merchant profile fields (name, mobile,
 *    city, merchant category code) and an IPv4 server allowlist for
 *    production — from the widely used community package config
 *    (codeboxr/upay) and UCB's own merchant user manual;
 *  - the operation SHAPE: a merchant-initiated hosted payment keyed
 *    by a merchant invoice id, a separate payment-query operation by
 *    invoice id, and gateway transaction ids of the form "UG…" (seen
 *    in Upay's own customer SMS text in the UCB manual).
 *
 * What is NOT grounded: every URL, path, field spelling and status
 * string below. They are PLACEHOLDERS shaped to the grounded facts
 * above (and to this codebase's SSLCommerz conventions), isolated
 * here so that correcting them is a one-file change once Nazmul has
 * a real Upay merchant account and the official document. The parsers
 * accept several common spellings per field to maximise the chance
 * the real responses parse, but that tolerance is a stopgap, NOT
 * verification: until the official document lands, `payment.upay.mode
 * = live` must be treated as UNTESTED, and the adapter's confirmation
 * rule (server-side query + invoice match + exact amount — see
 * src/integrations/upay.ts) is the only thing standing between a
 * wrong wire format and a wrongly-paid order. It fails closed: an
 * unrecognised response NEVER confirms a payment.
 *
 * The base URL can be overridden per-install from Settings
 * (payment.upay.api_base_url) without a code change, since the real
 * gateway host is one of the facts the official document will settle.
 */

/** ⚠️ PLACEHOLDER hosts — replace from Upay's official merchant API
 *  document. Overridable via Settings payment.upay.api_base_url. */
export const UPAY_BASE_URLS = {
  sandbox: "https://sandbox.upaybd.com",
  live: "https://gateway.upaybd.com",
} as const;

export type UpayMode = keyof typeof UPAY_BASE_URLS;

/** ⚠️ PLACEHOLDER paths — replace from the official document. */
export const UPAY_API_PATHS = {
  /** Create a hosted payment session for one invoice. */
  create: "/api/payment/create",
  /** Query one payment by merchant invoice id (path suffix). */
  queryByInvoice: "/api/payment/query",
} as const;

export interface UpayCredentials {
  merchantId: string;
  /** SECRET — encrypted at rest (EXACT_SECRET_KEYS in lib/settings). */
  merchantKey: string;
  merchantCode: string;
  merchantName?: string;
  merchantMobile?: string;
  merchantCity?: string;
  merchantCategoryCode?: string;
  /** Merchant server public IPv4 (production IP allowlist), when set. */
  serverIp?: string;
}

export interface UpayCreateRequest {
  /** Our PaymentAttempt id — also the merchant invoice id. */
  invoiceId: string;
  /** Integer poisha; converted to a BDT decimal string here, once. */
  amountPoisha: number;
  customerPhone: string;
  /** App origin, e.g. https://shop.example.com — callback + IPN
   *  URLs are derived from it exactly like the SSLCommerz adapter. */
  appOrigin: string;
  /** Dhaka calendar date (yyyy-mm-dd): the merchant API's create
   *  operation is date-keyed per the community packages. */
  dateDhaka: string;
}

/**
 * ⚠️ PLACEHOLDER body — field spellings follow the grounded
 * credential names + this codebase's gateway conventions. The
 * merchant key travels in the body (the SSLCommerz store_passwd
 * pattern); if the official document puts auth in a header instead,
 * this builder is the only place that changes.
 */
export function buildUpayCreatePayload(
  credentials: UpayCredentials,
  input: UpayCreateRequest,
  amountDecimal: string,
): Record<string, string> {
  const callback = `${input.appOrigin}/api/v1/public/payments/upay/callback`;
  const payload: Record<string, string> = {
    merchant_id: credentials.merchantId,
    merchant_code: credentials.merchantCode,
    merchant_key: credentials.merchantKey,
    invoice_id: input.invoiceId,
    // The attempt id doubles as the merchant transaction reference;
    // the invoice id is the authoritative key either way.
    txn_id: input.invoiceId,
    amount: amountDecimal,
    currency: "BDT",
    customer_mobile: input.customerPhone,
    date: input.dateDhaka,
    success_url: `${callback}?result=success`,
    fail_url: `${callback}?result=fail`,
    cancel_url: `${callback}?result=cancel`,
    ipn_url: `${input.appOrigin}/api/v1/public/payments/upay/ipn`,
  };
  if (credentials.merchantName) payload.merchant_name = credentials.merchantName;
  if (credentials.merchantMobile) payload.merchant_mobile = credentials.merchantMobile;
  if (credentials.merchantCity) payload.merchant_city = credentials.merchantCity;
  if (credentials.merchantCategoryCode) {
    payload.merchant_category_code = credentials.merchantCategoryCode;
  }
  if (credentials.serverIp) payload.server_ip = credentials.serverIp;
  return payload;
}

export interface UpayCreateRecord {
  /** Hosted checkout URL the customer is redirected to. */
  paymentUrl: string;
  /** Gateway transaction id ("UG…" per UCB's manual), when issued
   *  at create time. Null when the gateway only issues it later. */
  gatewayTransactionId: string | null;
}

function firstString(row: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return "";
}

/**
 * ⚠️ TOLERANT-BY-NECESSITY parser: accepts the plausible spellings of
 * the create response until the official document fixes one. A
 * response with no recognisable payment URL parses to null and the
 * adapter refuses the initiation — never a guessed redirect.
 */
export function parseUpayCreateResponse(data: unknown): UpayCreateRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const nested =
    typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>) : null;
  const source = nested ?? row;
  const paymentUrl = firstString(source, [
    "payment_url",
    "paymentURL",
    "gateway_url",
    "redirect_url",
    "checkout_url",
  ]);
  if (paymentUrl === "") return null;
  const status = firstString(row, ["status", "status_code", "code"]).toUpperCase();
  // When the envelope carries an explicit non-success status, a URL
  // in the same body is an error page, not a checkout — refuse it.
  if (status !== "" && !["SUCCESS", "SUCCEEDED", "200", "OK", "CREATED"].includes(status)) {
    return null;
  }
  const gatewayTransactionId = firstString(source, [
    "trx_id",
    "transaction_id",
    "gateway_trx_id",
    "upay_trx_id",
  ]);
  return { paymentUrl, gatewayTransactionId: gatewayTransactionId === "" ? null : gatewayTransactionId };
}

export type UpayQueryOutcome = "success" | "failed" | "pending" | "unknown";

export interface UpayQueryRecord {
  outcome: UpayQueryOutcome;
  /** Merchant invoice id echoed by the gateway (must equal ours). */
  invoiceId: string;
  /** Integer poisha parsed exactly from the gateway's amount. */
  amountPoisha: number | null;
  currency: string | null;
  /** Gateway transaction id ("UG…"), when the record carries one. */
  gatewayTransactionId: string | null;
}

/** ⚠️ PLACEHOLDER status vocabulary — the official document's exact
 *  strings replace these sets. Anything outside all three sets is
 *  "unknown", and unknown NEVER confirms a payment. */
const UPAY_SUCCESS_STATUSES: ReadonlySet<string> = new Set([
  "SUCCESS",
  "SUCCEEDED",
  "SUCCESSFUL",
  "COMPLETED",
  "PAID",
  "APPROVED",
]);
const UPAY_FAILED_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "FAILURE",
  "FAIL",
  "CANCELLED",
  "CANCELED",
  "REJECTED",
  "EXPIRED",
  "DECLINED",
]);
const UPAY_PENDING_STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "INITIATED",
  "PROCESSING",
  "IN_PROGRESS",
  "CREATED",
]);

/**
 * Parse a query-by-invoice response. `amountToPoisha` is injected
 * (src/payments/live-store.ts owns the exact BDT-decimal conversion)
 * so this file stays free of money math of its own.
 */
export function parseUpayQueryResponse(
  data: unknown,
  amountToPoisha: (value: string | number) => number | null,
): UpayQueryRecord | null {
  if (typeof data !== "object" || data === null) return null;
  const row = data as Record<string, unknown>;
  const nested =
    typeof row.data === "object" && row.data !== null ? (row.data as Record<string, unknown>) : null;
  const source = nested ?? row;
  const statusRaw = firstString(source, ["status", "payment_status", "txn_status", "state"]);
  if (statusRaw === "") return null;
  const status = statusRaw.toUpperCase();
  const outcome: UpayQueryOutcome = UPAY_SUCCESS_STATUSES.has(status)
    ? "success"
    : UPAY_FAILED_STATUSES.has(status)
      ? "failed"
      : UPAY_PENDING_STATUSES.has(status)
        ? "pending"
        : "unknown";
  const invoiceId = firstString(source, ["invoice_id", "invoiceId", "merchant_invoice_id", "order_id"]);
  const amountRaw = source.amount ?? source.total_amount ?? source.txn_amount;
  const amountPoisha =
    typeof amountRaw === "string" || typeof amountRaw === "number"
      ? amountToPoisha(amountRaw)
      : null;
  const currencyRaw = source.currency ?? source.currency_code;
  const gatewayTransactionId = firstString(source, [
    "trx_id",
    "transaction_id",
    "gateway_trx_id",
    "upay_trx_id",
  ]);
  return {
    outcome,
    invoiceId,
    amountPoisha,
    currency: typeof currencyRaw === "string" && currencyRaw !== "" ? currencyRaw : null,
    gatewayTransactionId: gatewayTransactionId === "" ? null : gatewayTransactionId,
  };
}
