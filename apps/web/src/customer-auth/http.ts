/**
 * Shared helpers for the /api/v1/public/account/* route handlers.
 * Response contract matches the rest of the public API:
 *   success: { data: ..., meta: {...} }
 *   error:   { error: { code, message, details? } }
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_MS,
  customerSessionCookieOptions,
  validateCustomerSessionToken,
  type PublicCustomer,
} from "./auth";

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

/** Logged-in customer for a route handler, or null (→ 401). */
export async function requireCustomer(): Promise<PublicCustomer | null> {
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
