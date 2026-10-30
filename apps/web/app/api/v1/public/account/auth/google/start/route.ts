/**
 * GET /api/v1/public/account/auth/google/start — begin Google
 * sign-in (doc 22 ADV-15).
 *
 * When Google credentials are absent from Settings the feature is
 * OFF: this route answers 503 NOT_CONFIGURED and the login page
 * never renders the button (server-driven availability flag), so
 * there is no working-looking button that goes nowhere. When
 * configured: a random state is stored in a short-lived httpOnly
 * cookie and the browser is redirected to Google's consent screen.
 */
import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_TTL_SECONDS,
  buildGoogleAuthorizationUrl,
  getGoogleAuthConfig,
  googleAppBaseUrl,
  googleRedirectUri,
} from "@/customer-auth/google";
import { errorResponse } from "@/customer-auth/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const config = await getGoogleAuthConfig();
  if (config === null) {
    return errorResponse("NOT_CONFIGURED", "Google লগইন সেটআপ করা হয়নি।", 503);
  }
  const state = randomBytes(16).toString("hex");
  const url = buildGoogleAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: googleRedirectUri(googleAppBaseUrl(req)),
    state,
  });
  const res = NextResponse.redirect(url);
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: GOOGLE_STATE_TTL_SECONDS,
  });
  return res;
}
