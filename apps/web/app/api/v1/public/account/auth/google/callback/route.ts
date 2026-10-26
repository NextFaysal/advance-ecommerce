/**
 * GET /api/v1/public/account/auth/google/callback — complete Google
 * sign-in (doc 22 ADV-15).
 *
 * Verifies the state cookie (CSRF), exchanges the code, and verifies
 * the id_token via Google's tokeninfo — audience MUST equal our
 * client id and email_verified MUST be true. The verified email
 * binds to the Customer row (see src/customer-auth/google.ts for the
 * binding rule + the googleId gap); the session is the SAME
 * customer_session cookie the password/OTP paths mint.
 *
 * Every failure lands back on /account?authError=google with one
 * generic message — no step of the flow leaks which check failed.
 * When credentials were removed mid-flow the route answers 503
 * NOT_CONFIGURED instead of pretending.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_TTL_MS,
  createCustomerSession,
  customerSessionCookieOptions,
} from "@/customer-auth/auth";
import {
  GOOGLE_STATE_COOKIE,
  exchangeGoogleCode,
  fetchGoogleIdTokenProfile,
  findOrCreateCustomerForGoogle,
  getGoogleAuthConfig,
  googleAppBaseUrl,
  googleRedirectUri,
} from "@/customer-auth/google";
import { errorResponse, requestMeta } from "@/customer-auth/http";

export async function GET(req: Request) {
  const base = googleAppBaseUrl(req);
  const fail = () => NextResponse.redirect(new URL("/account?authError=google", base));

  const config = await getGoogleAuthConfig();
  if (config === null) {
    return errorResponse("NOT_CONFIGURED", "Google লগইন সেটআপ করা হয়নি।", 503);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") !== null || code === null || code === "" || state === null) {
    return fail();
  }

  const store = await cookies();
  const expectedState = store.get(GOOGLE_STATE_COOKIE)?.value;
  if (expectedState === undefined || expectedState === "" || expectedState !== state) {
    return fail();
  }

  let customer;
  try {
    const { idToken } = await exchangeGoogleCode({
      code,
      config,
      redirectUri: googleRedirectUri(base),
    });
    const profile = await fetchGoogleIdTokenProfile({ idToken, clientId: config.clientId });
    customer = await findOrCreateCustomerForGoogle(profile);
  } catch {
    return fail();
  }
  if (customer === null) return fail(); // blocked / soft-deleted account

  const { ip, userAgent } = requestMeta(req);
  const { token } = await createCustomerSession({ customerId: customer.id, ip, userAgent });
  const res = NextResponse.redirect(new URL("/account", base));
  res.cookies.set(
    CUSTOMER_SESSION_COOKIE,
    token,
    customerSessionCookieOptions(Math.floor(CUSTOMER_SESSION_TTL_MS / 1000)),
  );
  // The state is single-use — clear it on the way out.
  res.cookies.set(GOOGLE_STATE_COOKIE, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return res;
}
