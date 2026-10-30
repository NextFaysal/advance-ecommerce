/**
 * GET /api/v1/public/account/auth/facebook/start — begin Facebook
 * sign-in (doc 22 ADV-15 remainder).
 *
 * Mirrors the Google start route exactly: when Facebook credentials
 * are absent from Settings the feature is OFF — this route answers
 * 503 NOT_CONFIGURED and the login page never renders the button
 * (server-driven availability flag), so there is no working-looking
 * button that goes nowhere. When configured: a random state is
 * stored in a short-lived httpOnly cookie and the browser is
 * redirected to Facebook's consent dialog.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  FACEBOOK_STATE_COOKIE,
  FACEBOOK_STATE_TTL_SECONDS,
  buildFacebookAuthorizationUrl,
  facebookAppBaseUrl,
  facebookRedirectUri,
  getFacebookAuthConfig,
} from "@/customer-auth/facebook";
import { errorResponse } from "@/customer-auth/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = await getFacebookAuthConfig();
  if (config === null) {
    return errorResponse("NOT_CONFIGURED", "Facebook লগইন সেটআপ করা হয়নি।", 503);
  }
  const state = randomBytes(16).toString("hex");
  const url = buildFacebookAuthorizationUrl({
    appId: config.appId,
    redirectUri: facebookRedirectUri(facebookAppBaseUrl(req)),
    state,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(FACEBOOK_STATE_COOKIE, state, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: FACEBOOK_STATE_TTL_SECONDS,
  });
  return res;
}
