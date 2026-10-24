/**
 * POST /api/v1/public/account/logout — revoke the current customer
 * session (DB row) and clear the customer_session cookie. Idempotent:
 * logging out with no/invalid session still succeeds.
 */
import { NextResponse } from "next/server";
import { CUSTOMER_SESSION_COOKIE, customerSessionCookieOptions, revokeCustomerSession } from "@/customer-auth/auth";
import { customerSessionToken, methodNotAllowed } from "@/customer-auth/http";

export async function POST() {
  const token = await customerSessionToken();
  if (token !== null) {
    await revokeCustomerSession(token);
  }
  const res = NextResponse.json({ data: { loggedOut: true }, meta: { db: "PRISMA" } });
  res.cookies.set(CUSTOMER_SESSION_COOKIE, "", { ...customerSessionCookieOptions(0), maxAge: 0 });
  return res;
}

export function GET() {
  return methodNotAllowed();
}
