/**
 * GET /api/v1/public/account/auth/facebook/callback — complete
 * Facebook sign-in (doc 22 ADV-15 remainder).
 *
 * Mirrors the Google callback: verifies the state cookie (CSRF),
 * exchanges the code, reads the profile from the Graph API, binds
 * it to the Customer row with the SAME claim rules as Google (see
 * src/customer-auth/facebook.ts), and issues the SAME
 * customer_session cookie the password/OTP/Google paths mint.
 *
 * Failures land back on /account with a generic message that never
 * leaks which check failed — with ONE deliberate exception: when
 * Facebook returns no email there is no trustworthy identifier to
 * bind, so the redirect carries authError=facebook_no_email and the
 * account page honestly tells the customer Facebook did not share
 * an email and to use phone/OTP instead. No account is ever created
 * without an identifier. When credentials were removed mid-flow
 * the route answers 503 NOT_CONFIGURED instead of pretending.
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
  FACEBOOK_STATE_COOKIE,
  FacebookAuthError,
  exchangeFacebookCode,
  facebookAppBaseUrl,
  facebookRedirectUri,
  fetchFacebookProfile,
  findOrCreateCustomerForFacebook,
  getFacebookAuthConfig,
} from "@/customer-auth/facebook";
import { errorResponse, requestMeta } from "@/customer-auth/http";

export async function GET(req: Request) {
  const base = facebookAppBaseUrl(req);
  const fail = () => NextResponse.redirect(new URL("/account?authError=facebook", base));
  const failNoEmail = () =>
    NextResponse.redirect(new URL("/account?authError=facebook_no_email", base));

  const config = await getFacebookAuthConfig();
  if (config === null) {
    return errorResponse("NOT_CONFIGURED", "Facebook লগইন সেটআপ করা হয়নি।", 503);
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error") !== null || code === null || code === "" || state === null) {
    return fail();
  }

  const store = await cookies();
  const expectedState = store.get(FACEBOOK_STATE_COOKIE)?.value;
  if (expectedState === undefined || expectedState === "" || expectedState !== state) {
    return fail();
  }

  let customer;
  try {
    const { accessToken } = await exchangeFacebookCode({
      code,
      config,
      redirectUri: facebookRedirectUri(base),
    });
    const profile = await fetchFacebookProfile({ accessToken });
    customer = await findOrCreateCustomerForFacebook(profile);
  } catch (err) {
    // The one distinguished failure: Facebook shared no email.
    if (err instanceof FacebookAuthError && err.code === "EMAIL_MISSING") {
      return failNoEmail();
    }
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
  res.cookies.set(FACEBOOK_STATE_COOKIE, "", {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
  return res;
}
