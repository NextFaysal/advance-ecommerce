/**
 * Real SMS gateway adapters — ADV-2 (doc 22).
 *
 * Implements the SmsProvider interface (src/integrations/sms.ts) for the
 * three BD gateways the settings registry knows:
 *
 *   bulksmsbd    POST https://bulksmsbd.net/api/smsapi
 *                form fields: api_key, type (text|unicode), number
 *                (comma-separated, 8801XXXXXXXXX), senderid, message.
 *                Success: { response_type: "success", message_id }.
 *                Error:   { response_type: "error", error_code, error_message }.
 *                Also accepted: the numeric-code response family
 *                (202 = success; 1001/1002/1007/1011 = named errors).
 *                Balance: GET /api/getBalanceApi?api_key=… -> { balance }.
 *                PROVENANCE: BulkSMSBD publishes NO public API docs —
 *                its official documentation lives inside the merchant
 *                panel. The JSON envelope above is therefore NOT
 *                publicly documented; the endpoint + api_key/senderid
 *                model are corroborated by independent third-party
 *                packages. UNSETTLED pending the first live send: the
 *                recipient parameter spelling (number vs numbers) and
 *                the number format (880… vs 01…) — each is a one-line
 *                change once the live account shows which is right.
 *
 *   sslwireless  POST https://smsplus.sslwireless.com/api/v3/send-sms
 *                JSON body: { api_token, sid, msisdn, sms, csms_id }.
 *                Success: { status: "SUCCESS", statusInfo: [...] }.
 *                Failure: { status: "FAILED", status_code, error_message }.
 *                Balance: GET /api/v3/balance?api_token=… (query param).
 *                PROVENANCE: SSL Wireless publishes no public v3
 *                documentation (the docs are merchant-distributed);
 *                these shapes rest on convergent third-party
 *                implementations, pending a first live test.
 *
 *   greenweb     POST https://api.greenweb.com.bd/api.php?json
 *                form fields: token, to (comma-separated), message.
 *                Documented response: a per-recipient ARRAY
 *                [{ to, message, status: "SENT"|"FAILED", statusmsg }]
 *                (no message id is returned). Balance: GET
 *                g_api.php?token=…&balance&json ->
 *                [{ token, action: "balance", response: "<amount>" }].
 *                Source: Green Web BD Team's own manual "BD Bulk SMS —
 *                API (English Manual)" (bdbulksms.net), confirmed by
 *                live probes with the manual's sanctioned demo token
 *                on 2026-10-30.
 *
 * HONESTY RULES (platform-wide, do not weaken):
 *  - A send that the provider did not clearly accept THROWS
 *    SmsProviderError. Handlers treat a resolved promise as success, so
 *    returning a "failed" result would be a phantom success — the throw
 *    is what gives BullMQ its retry / dead-letter semantics.
 *  - An unrecognised response shape throws UNRECOGNIZED_RESPONSE, never
 *    a guessed success. Response parsers accept the documented shapes
 *    above; the final live verification happens when Nazmul connects a
 *    real gateway account (doc 22 ADV-2 acceptance).
 *  - Credentials are constructor inputs only. They are never logged,
 *    never placed in an error message (several balance URLs carry the
 *    credential in the query string — errors report the provider
 *    code/status only, never the URL).
 *  - Money: provider balances are BDT decimals; they are converted to
 *    integer poisha here (the platform's money unit) exactly once.
 *
 * This module is pure of the settings store: callers pass plain
 * credential objects (see sms-resolver.ts for the Settings-driven
 * resolution). fetch is injectable so the whole surface is smoke-testable
 * with a mocked network — no real SMS is ever sent from a test.
 */
import { randomBytes } from "node:crypto";
import { normalizeBdPhone } from "../checkout/validation";
import { isUnicodeMessage, smsSegments } from "../marketing/service";
import type { SmsProvider, SmsProviderName, SmsSendInput, SmsSendResult } from "./sms";
import type { ProviderConfig } from "./types";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class SmsProviderError extends Error {
  readonly provider: SmsProviderName;
  /** Machine code: NOT_CONFIGURED | INVALID_PHONE | NETWORK |
   *  HTTP_<status> | UNRECOGNIZED_RESPONSE | <PROVIDER>_<provider code>. */
  readonly code: string;

  constructor(provider: SmsProviderName, code: string, message: string) {
    super(message);
    this.name = "SmsProviderError";
    this.provider = provider;
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Shared plumbing                                                     */
/* ------------------------------------------------------------------ */

export type SmsFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SmsAdapterOptions {
  fetchFn?: SmsFetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export interface SmsBalance {
  /** Integer poisha (BDT balance x 100), never a float taka amount. */
  balancePoisha: number;
  currency: "BDT";
}

export interface SmsBulkResult {
  /** One entry per provider submission (batch APIs return one id for
   *  the whole submission; sequential APIs return one per recipient). */
  messageIds: string[];
  segments: number;
}

/** A gateway provider: the base SmsProvider contract plus the balance
 *  probe and a bulk send (single batch call where the provider's API
 *  supports it, sequential single sends where it does not). */
export interface SmsGatewayProvider extends SmsProvider {
  getBalance(): Promise<SmsBalance>;
  sendBulk(
    toPhones: readonly string[],
    message: string,
    opts?: { templateKey?: string | null; orderId?: string | null },
  ): Promise<SmsBulkResult>;
}

function realConfig(name: SmsProviderName): ProviderConfig {
  return {
    provider: name,
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credential lives — never the value.
    credentialRef: `settings:sms.${name}`,
    lastTestedAt: null,
    lastError: null,
  };
}

/** Normalise via the shared BD helper and return the provider form
 *  (8801XXXXXXXXX, no leading +). Throws INVALID_PHONE before any
 *  network call when the number is not a valid BD mobile. */
function providerNumber(provider: SmsProviderName, raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new SmsProviderError(provider, "INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return normalized.slice(1); // strip "+"
}

function requireMessage(provider: SmsProviderName, message: string): void {
  if (message.trim() === "") {
    throw new SmsProviderError(provider, "EMPTY_MESSAGE", "SMS message body is empty.");
  }
}

async function callFetch(
  provider: SmsProviderName,
  fetchFn: SmsFetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    // Network failure / timeout: no URL in the message (it may carry a
    // credential in the query string for two of the three providers).
    throw new SmsProviderError(provider, "NETWORK", `${provider} request failed (network error or timeout).`);
  }
  const text = await res.text().catch(() => "");
  if (res.status < 200 || res.status >= 300) {
    throw new SmsProviderError(provider, `HTTP_${res.status}`, `${provider} returned HTTP ${res.status}.`);
  }
  return { status: res.status, text };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number") return String(value);
  }
  return null;
}

/** BDT decimal (string or number) -> integer poisha, exactly once. */
function bdtToPoisha(provider: SmsProviderName, value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new SmsProviderError(provider, "UNRECOGNIZED_RESPONSE", `${provider} balance response had no numeric balance.`);
  }
  return Math.round(num * 100);
}

function postForm(
  provider: SmsProviderName,
  fetchFn: SmsFetch,
  url: string,
  fields: Record<string, string>,
  timeoutMs: number,
): Promise<{ status: number; text: string }> {
  return callFetch(
    provider,
    fetchFn,
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    timeoutMs,
  );
}

/* ------------------------------------------------------------------ */
/* BulkSMSBD                                                           */
/* ------------------------------------------------------------------ */

export interface BulkSmsBdCredentials {
  apiKey: string;
  senderId: string | null;
}

const BULKSMSBD_BASE = "https://bulksmsbd.net/api";

/** The numeric-code response family (third-party documented; the
 *  official docs are panel-gated). 202 is the success code; these are
 *  the named failure codes. Any other numeric code surfaces as a
 *  generic BULKSMSBD_<code> provider error. */
const BULKSMSBD_NUMERIC_ERRORS: Record<string, { code: string; message: string }> = {
  "1001": { code: "BULKSMSBD_INVALID_NUMBER", message: "invalid number" },
  "1002": { code: "BULKSMSBD_SENDER_ID", message: "sender id not correct or disabled" },
  "1007": { code: "BULKSMSBD_INSUFFICIENT_BALANCE", message: "insufficient balance" },
  "1011": { code: "BULKSMSBD_USER_NOT_FOUND", message: "user id not found" },
};

export function createBulkSmsBdProvider(
  creds: BulkSmsBdCredentials,
  opts: SmsAdapterOptions = {},
): SmsGatewayProvider {
  const name: SmsProviderName = "bulksmsbd";
  if (creds.apiKey.trim() === "") {
    throw new SmsProviderError(name, "NOT_CONFIGURED", "BulkSMSBD api_key is not configured.");
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function submit(numbers: string[], message: string): Promise<string> {
    const fields: Record<string, string> = {
      api_key: creds.apiKey,
      type: isUnicodeMessage(message) ? "unicode" : "text",
      number: numbers.join(","),
      message,
    };
    if (creds.senderId !== null && creds.senderId !== "") fields.senderid = creds.senderId;
    const { text } = await postForm(name, fetchFn, `${BULKSMSBD_BASE}/smsapi`, fields, timeoutMs);
    const json = asRecord(parseJsonLoose(text));
    if (json !== null && json.response_type === "success") {
      // Their API returns one message_id per submission (batch included).
      return stringField(json, "message_id", "messageId") ?? `bulksmsbd:noid:${numbers.length}`;
    }
    if (json !== null && json.response_type === "error") {
      const code = stringField(json, "error_code") ?? "UNKNOWN";
      const message = stringField(json, "error_message") ?? "provider rejected the send";
      throw new SmsProviderError(name, `BULKSMSBD_${code}`, `BulkSMSBD error ${code}: ${message}`);
    }
    // Numeric-code family: a bare numeric body ("202") or a JSON body
    // carrying a numeric code under response_code / code / status.
    // Accepting it only WIDENS the parser — a send the provider
    // accepted must not die here as UNRECOGNIZED_RESPONSE.
    const numericCode =
      json !== null
        ? stringField(json, "response_code", "code", "status")
        : /^\d+$/.test(text.trim())
          ? text.trim()
          : null;
    if (numericCode !== null && /^\d+$/.test(numericCode)) {
      if (numericCode === "202") {
        return (json !== null ? stringField(json, "message_id", "messageId") : null) ?? `bulksmsbd:noid:${numbers.length}`;
      }
      const known = BULKSMSBD_NUMERIC_ERRORS[numericCode];
      if (known !== undefined) {
        throw new SmsProviderError(name, known.code, `BulkSMSBD error ${numericCode}: ${known.message}`);
      }
      throw new SmsProviderError(name, `BULKSMSBD_${numericCode}`, `BulkSMSBD returned error code ${numericCode}.`);
    }
    throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "BulkSMSBD returned an unrecognised response.");
  }

  return {
    name,
    config: realConfig(name),
    async send(input: SmsSendInput): Promise<SmsSendResult> {
      requireMessage(name, input.message);
      const number = providerNumber(name, input.toPhone);
      const messageId = await submit([number], input.message);
      return { messageId, status: "sent", segments: smsSegments(input.message) };
    },
    async sendBulk(toPhones, message) {
      requireMessage(name, message);
      if (toPhones.length === 0) {
        throw new SmsProviderError(name, "NO_RECIPIENTS", "Bulk send called with no recipients.");
      }
      const numbers = toPhones.map((p) => providerNumber(name, p));
      const messageId = await submit(numbers, message);
      return { messageIds: [messageId], segments: smsSegments(message) };
    },
    async getBalance(): Promise<SmsBalance> {
      const url = `${BULKSMSBD_BASE}/getBalanceApi?api_key=${encodeURIComponent(creds.apiKey)}`;
      const { text } = await callFetch(name, fetchFn, url, { method: "GET" }, timeoutMs);
      const json = asRecord(parseJsonLoose(text));
      if (json === null || !("balance" in json)) {
        throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "BulkSMSBD balance response had no balance field.");
      }
      return { balancePoisha: bdtToPoisha(name, json.balance), currency: "BDT" };
    },
  };
}

/* ------------------------------------------------------------------ */
/* SSL Wireless (smsplus v3)                                           */
/* ------------------------------------------------------------------ */

export interface SslWirelessCredentials {
  /** Settings key sms.sslwireless.api_token. The property keeps the
   *  camelCase name because sms-resolver.ts constructs this object;
   *  the WIRE key in the send body is api_token (see submitOne). */
  apiToken: string;
  /** The account SID — doubles as the sender identity. */
  sid: string;
}

const SSLWIRELESS_BASE = "https://smsplus.sslwireless.com/api/v3";

export function createSslWirelessProvider(
  creds: SslWirelessCredentials,
  opts: SmsAdapterOptions = {},
): SmsGatewayProvider {
  const name: SmsProviderName = "sslwireless";
  if (creds.apiToken.trim() === "" || creds.sid.trim() === "") {
    throw new SmsProviderError(name, "NOT_CONFIGURED", "SSL Wireless api_token and sid are both required.");
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function submitOne(number: string, message: string): Promise<string> {
    // csms_id is the client-side unique id the provider echoes back and
    // accepts for status correlation; it must differ per send.
    const csmsId = `ae-${Date.now().toString(36)}-${randomBytes(6).toString("hex")}`;
    const { text } = await callFetch(
      name,
      fetchFn,
      `${SSLWIRELESS_BASE}/send-sms`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          // Wire key is api_token (unanimous third-party spelling, and
          // our own Settings key name) — NOT the camelCase apiToken.
          api_token: creds.apiToken,
          sid: creds.sid,
          msisdn: number,
          sms: message,
          csms_id: csmsId,
        }),
      },
      timeoutMs,
    );
    const json = asRecord(parseJsonLoose(text));
    if (json !== null && json.status === "SUCCESS") {
      const info = Array.isArray(json.statusInfo) ? asRecord(json.statusInfo[0]) : null;
      const inner = info !== null ? asRecord(info.smsInfo) ?? info : null;
      const perRecipient = inner !== null ? stringField(inner, "smsStatus", "sms_status", "status") : null;
      if (perRecipient !== null && /fail|error|reject/i.test(perRecipient)) {
        throw new SmsProviderError(name, "SSLWIRELESS_RECIPIENT", `SSL Wireless rejected the recipient (${perRecipient}).`);
      }
      return (
        (inner !== null ? stringField(inner, "referenceId", "reference_id", "csms_id", "csmsId") : null) ??
        csmsId
      );
    }
    const status = json !== null ? stringField(json, "status") ?? "UNKNOWN" : "UNPARSEABLE";
    // Failure bodies carry the real reason in error_message plus a
    // numeric status_code (e.g. {"status":"FAILED","status_code":4003,
    // "error_message":"IP Blacklisted"}) — surface BOTH; discarding
    // them left operators with a bare status and no diagnosis.
    const statusCode = json !== null ? stringField(json, "status_code", "statusCode") : null;
    const detail =
      json !== null ? stringField(json, "error_message", "errorMessage", "message", "error") : null;
    throw new SmsProviderError(
      name,
      `SSLWIRELESS_${status}`,
      `SSL Wireless send failed (${status}${statusCode !== null ? `, status_code ${statusCode}` : ""})${detail !== null ? `: ${detail}` : ""}.`,
    );
  }

  return {
    name,
    config: realConfig(name),
    async send(input: SmsSendInput): Promise<SmsSendResult> {
      requireMessage(name, input.message);
      const number = providerNumber(name, input.toPhone);
      const messageId = await submitOne(number, input.message);
      return { messageId, status: "sent", segments: smsSegments(input.message) };
    },
    async sendBulk(toPhones, message) {
      requireMessage(name, message);
      if (toPhones.length === 0) {
        throw new SmsProviderError(name, "NO_RECIPIENTS", "Bulk send called with no recipients.");
      }
      // The v3 single-send contract is the verified shape; bulk is a
      // sequential fan-out over it (a failure throws, so a partial bulk
      // is never reported as a full success).
      const messageIds: string[] = [];
      for (const phone of toPhones) {
        messageIds.push(await submitOne(providerNumber(name, phone), message));
      }
      return { messageIds, segments: smsSegments(message) };
    },
    async getBalance(): Promise<SmsBalance> {
      // Observed third-party usage: the token travels as the api_token
      // QUERY parameter — there is no Bearer-header variant.
      const { text } = await callFetch(
        name,
        fetchFn,
        `${SSLWIRELESS_BASE}/balance?api_token=${encodeURIComponent(creds.apiToken)}`,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
      );
      const json = asRecord(parseJsonLoose(text));
      const data = json !== null ? asRecord(json.data) : null;
      const raw = json !== null && "balance" in json ? json.balance : data !== null ? data.balance : undefined;
      if (raw === undefined) {
        throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "SSL Wireless balance response had no balance field.");
      }
      return { balancePoisha: bdtToPoisha(name, raw), currency: "BDT" };
    },
  };
}

/* ------------------------------------------------------------------ */
/* GreenWeb                                                            */
/* ------------------------------------------------------------------ */

export interface GreenWebCredentials {
  token: string;
}

/** Send endpoint, JSON mode (manual: api.php?json). */
const GREENWEB_SEND_URL = "https://api.greenweb.com.bd/api.php?json";
/** Balance endpoint (manual: g_api.php?token=…&balance&json). */
const GREENWEB_BALANCE_URL = "https://api.greenweb.com.bd/g_api.php";

export function createGreenWebProvider(
  creds: GreenWebCredentials,
  opts: SmsAdapterOptions = {},
): SmsGatewayProvider {
  const name: SmsProviderName = "greenweb";
  if (creds.token.trim() === "") {
    throw new SmsProviderError(name, "NOT_CONFIGURED", "GreenWeb token is not configured.");
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** The manual's documented JSON-mode response is a per-recipient
   *  ARRAY: [{ to, message, status: "SENT"|"FAILED", statusmsg }].
   *  SENT = accepted; FAILED throws carrying `statusmsg` — NEVER the
   *  entry's `message` field, which is the SMS body itself echoed
   *  back. The response carries no message id, so callers keep the
   *  synthesized-id convention. Any other shape throws. */
  function parseSendResponse(text: string): void {
    const parsed = parseJsonLoose(text);
    if (!Array.isArray(parsed)) {
      throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb returned an unrecognised response.");
    }
    if (parsed.length === 0) {
      throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb returned an empty result set.");
    }
    for (const item of parsed) {
      const entry = asRecord(item);
      if (entry === null) {
        throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb returned a malformed result entry.");
      }
      const status = stringField(entry, "status");
      if (status === "SENT") continue;
      if (status === "FAILED") {
        const detail = stringField(entry, "statusmsg");
        throw new SmsProviderError(
          name,
          "GREENWEB_REJECTED",
          `GreenWeb rejected the send${detail !== null ? `: ${detail}` : ""}.`,
        );
      }
      throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb returned an unrecognised per-recipient status.");
    }
  }

  async function submit(numbers: string[], message: string): Promise<string> {
    const { text } = await postForm(
      name,
      fetchFn,
      GREENWEB_SEND_URL,
      { token: creds.token, to: numbers.join(","), message },
      timeoutMs,
    );
    parseSendResponse(text);
    return `greenweb:noid:${numbers.length}`;
  }

  return {
    name,
    config: realConfig(name),
    async send(input: SmsSendInput): Promise<SmsSendResult> {
      requireMessage(name, input.message);
      const number = providerNumber(name, input.toPhone);
      const messageId = await submit([number], input.message);
      return { messageId, status: "sent", segments: smsSegments(input.message) };
    },
    async sendBulk(toPhones, message) {
      requireMessage(name, message);
      if (toPhones.length === 0) {
        throw new SmsProviderError(name, "NO_RECIPIENTS", "Bulk send called with no recipients.");
      }
      const numbers = toPhones.map((p) => providerNumber(name, p));
      const messageId = await submit(numbers, message);
      return { messageIds: [messageId], segments: smsSegments(message) };
    },
    async getBalance(): Promise<SmsBalance> {
      const url = `${GREENWEB_BALANCE_URL}?token=${encodeURIComponent(creds.token)}&balance&json`;
      const { text } = await callFetch(name, fetchFn, url, { method: "GET" }, timeoutMs);
      const parsed = parseJsonLoose(text);
      if (Array.isArray(parsed)) {
        // Documented shape: [{ token, action: "balance", response: "1000" }]
        // — the amount is the entry's `response` field.
        const entry = parsed.length > 0 ? asRecord(parsed[0]) : null;
        const raw = entry !== null ? entry.response : undefined;
        if (raw === undefined) {
          throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb balance response had no response field.");
        }
        // NOTE: the manual never states the unit of this figure; the
        // BDT→poisha conversion is kept, but the unit itself is
        // UNVERIFIABLE from the manual.
        return { balancePoisha: bdtToPoisha(name, raw), currency: "BDT" };
      }
      // Tolerate the bare-number plain-text form of the same endpoint.
      const trimmed = text.trim();
      if (trimmed !== "" && Number.isFinite(Number(trimmed))) {
        return { balancePoisha: bdtToPoisha(name, trimmed), currency: "BDT" };
      }
      throw new SmsProviderError(name, "UNRECOGNIZED_RESPONSE", "GreenWeb balance response had no readable balance.");
    },
  };
}
