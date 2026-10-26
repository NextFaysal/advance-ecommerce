/**
 * Shared helpers for the /api/v1/public/account/* route handlers.
 * Response contract matches the rest of the public API:
 *   success: { data: ..., meta: {...} }
 *   error:   { error: { code, message, details? } }
 */
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_MS,
  customerSessionCookieOptions,
  validateCustomerSessionToken,
  type PublicCustomer,
} from "./auth";
import { parseCustomerBearer, validateCustomerApiToken } from "./api-tokens";

export function errorResponse(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export function methodNotAllowed() {
  return errorResponse("METHOD_NOT_ALLOWED", "Use the documented method for this endpoint.", 405);
}

/** The session token from the customer_session cookie, if any. */
export async function customerSessionToken(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(CUSTOMER_SESSION_COOKIE)?.value;
  return value === undefined || value === "" ? null : value;
}

/**
 * Logged-in customer for a route handler, or null (→ 401).
 *
 * Two credentials, ONE seam (every /account/* route — and the B2B
 * portal guard built on this helper — gets both):
 *  - `Authorization: Bearer ae_cust_…` — a customer API token
 *    (src/customer-auth/api-tokens.ts), the native-app seam.
 *  - the `customer_session` cookie — the browser session.
 *
 * A PRESENTED Authorization header decides ALONE: an invalid,
 * revoked or malformed bearer returns null (→ 401) and NEVER falls
 * back to the cookie — the bd device-token precedent. Falling back
 * would let a request carrying a revoked token through on any stray
 * browser cookie, silently defeating revocation. With no header,
 * the cookie path runs exactly as it did before tokens existed.
 */
export async function requireCustomer(): Promise<PublicCustomer | null> {
  const authorization = (await headers()).get("authorization");
  if (authorization !== null && authorization.trim() !== "") {
    const bearer = parseCustomerBearer(authorization);
    if (bearer === null) return null;
    return validateCustomerApiToken(bearer);
  }
  return requireCustomerSession();
}

/**
 * Cookie-session ONLY — for surfaces a bearer token must never
 * reach: token management itself (a leaked token must not mint or
 * revoke tokens). Otherwise identical to the historical
 * requireCustomer().
 */
export async function requireCustomerSession(): Promise<PublicCustomer | null> {
  const token = await customerSessionToken();
  if (token === null) return null;
  return validateCustomerSessionToken(token);
}

export function unauthorized() {
  return errorResponse("UNAUTHORIZED", "আগে লগইন করুন।", 401);
}

/** Attach a fresh customer session cookie to a response. */
export function withSessionCookie(res: NextResponse, token: string): NextResponse {
  res.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    token,
    customerSessionCookieOptions(Math.floor(CUSTOMER_SESSION_TTL_MS / 1000)),
  );
  return res;
}

export function requestMeta(req: Request): { ip: string; userAgent?: string } {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
    userAgent: req.headers.get("user-agent") ?? undefined,
  };
}
