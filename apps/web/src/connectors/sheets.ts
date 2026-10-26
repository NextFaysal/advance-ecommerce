/**
 * Google Sheets connector (ADV-25 part 2).
 *
 * Appends ONE row per order.created to the merchant's spreadsheet —
 * the sheet is an order log, not a chat channel, so this connector
 * deliberately fires on order.created only (plus the admin test,
 * which appends a clearly-marked TEST row). Status-change chatter
 * belongs in Slack/Telegram.
 *
 * Auth is the service-account JWT flow, implemented with node:crypto
 * only (no googleapis dependency):
 *   1. RS256-sign a JWT (iss = client_email, scope = spreadsheets,
 *      aud = the OAuth2 token endpoint) with the account's private
 *      key from the encrypted service_account_json Setting.
 *   2. Exchange it at oauth2.googleapis.com/token for an access
 *      token (grant_type = jwt-bearer).
 *   3. POST spreadsheets/{id}/values/{sheet}!A1:append.
 *
 * Honesty rules: the private key and the signed assertion are never
 * logged or recorded; failures surface the provider's error CODE
 * (e.g. "invalid_grant", "sheets_permission_denied", "http_404") —
 * never a fabricated success.
 */
import { createSign } from "node:crypto";
import type { SheetsConfig } from "./config";
import type { ChannelSendResult, FetchFn } from "./types";

const TIMEOUT_MS = 15_000;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_API_BASE = "https://sheets.googleapis.com/v4";
const SPREADSHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

/** Parse + validate the stored service-account JSON. Returns null
 *  (→ invalid_service_account_json) for anything unusable. */
export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(json) as {
      client_email?: unknown;
      private_key?: unknown;
    };
    if (typeof parsed.client_email !== "string" || parsed.client_email === "") return null;
    if (typeof parsed.private_key !== "string" || parsed.private_key === "") return null;
    return {
      clientEmail: parsed.client_email,
      // Stored JSON usually carries real newlines; pasted copies may
      // carry literal "\n" escapes — normalise both to a usable PEM.
      privateKey: parsed.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Build the signed JWT assertion (exported for tests). Throws only
 *  when the private key cannot sign at all — callers convert that to
 *  the invalid_service_account_json code. */
export function buildServiceAccountJwt(account: ServiceAccount, now: Date = new Date()): string {
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SPREADSHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(account.privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

/** Keep only codes that are safe to store: short, code-shaped. */
function sanitizeProviderCode(raw: string): string | null {
  return /^[a-z0-9_.\-]{1,60}$/i.test(raw) ? raw : null;
}

type TokenResult = { accessToken: string } | { errorCode: string; detail: string };

async function exchangeToken(
  assertion: string,
  fetchFn: FetchFn,
  tokenUrl: string,
): Promise<TokenResult> {
  try {
    const res = await fetchFn(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
      error?: string;
    } | null;
    if (res.ok && typeof body?.access_token === "string" && body.access_token !== "") {
      return { accessToken: body.access_token };
    }
    const providerCode = typeof body?.error === "string" ? sanitizeProviderCode(body.error) : null;
    const errorCode = providerCode ?? `http_${res.status}`;
    return {
      errorCode,
      detail: `Google token exchange refused the service account (${errorCode}).`,
    };
  } catch {
    return {
      errorCode: "network_error",
      detail: "Google token endpoint could not be reached (network error or timeout).",
    };
  }
}

/** Test seams: production uses Google's real endpoints. */
export interface SheetsEndpoints {
  tokenUrl?: string;
  sheetsApiBase?: string;
}

/**
 * Full send: credentials → token → append one row. `values` is the
 * row from formatSheetsRow. Any failure is a coded result, never a
 * throw and never a fake success.
 */
export async function sendSheetsRow(
  config: Pick<SheetsConfig, "serviceAccountJson" | "spreadsheetId" | "sheetName">,
  values: string[],
  fetchFn: FetchFn = fetch,
  now: Date = new Date(),
  endpoints: SheetsEndpoints = {},
): Promise<ChannelSendResult> {
  const account = parseServiceAccount(config.serviceAccountJson);
  if (account === null) {
    return {
      ok: false,
      errorCode: "invalid_service_account_json",
      detail:
        "connectors.sheets.service_account_json is not a valid service-account JSON (client_email + private_key required).",
    };
  }

  let assertion: string;
  try {
    assertion = buildServiceAccountJwt(account, now);
  } catch {
    return {
      ok: false,
      errorCode: "invalid_service_account_json",
      detail: "The service-account private key could not sign a JWT (malformed PEM).",
    };
  }

  const token = await exchangeToken(assertion, fetchFn, endpoints.tokenUrl ?? TOKEN_URL);
  if ("errorCode" in token) return { ok: false, errorCode: token.errorCode, detail: token.detail };

  const base = (endpoints.sheetsApiBase ?? SHEETS_API_BASE).replace(/\/+$/, "");
  const range = encodeURIComponent(`${config.sheetName}!A1`);
  const url = `${base}/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  try {
    const res = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token.accessToken}`,
      },
      body: JSON.stringify({ values: [values] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as {
      error?: { status?: string };
    } | null;
    const providerStatus =
      typeof body?.error?.status === "string" ? sanitizeProviderCode(body.error.status) : null;
    const errorCode =
      providerStatus !== null ? `sheets_${providerStatus.toLowerCase()}` : `http_${res.status}`;
    return {
      ok: false,
      errorCode,
      detail: `Google Sheets append refused the row (${errorCode}).`,
    };
  } catch {
    return {
      ok: false,
      errorCode: "network_error",
      detail: "Google Sheets API could not be reached (network error or timeout).",
    };
  }
}
