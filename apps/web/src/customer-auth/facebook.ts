/**
 * Customer Facebook sign-in — doc 22 ADV-15 remainder.
 *
 * A deliberate mirror of src/customer-auth/google.ts: plain OAuth
 * 2.0 authorization-code flow over fetch (no new deps):
 *   start route    → 302 to Facebook's dialog with a random `state`
 *                    kept in an httpOnly cookie (same protections as
 *                    the Google flow: httpOnly, sameSite lax, secure
 *                    in production, 10-minute lifetime);
 *   callback route → code exchanged at graph.facebook.com, profile
 *                    read from GET /me?fields=id,name,email with the
 *                    resulting access token.
 *
 * Configuration lives in Settings (auth.facebook.app_id /
 * auth.facebook.app_secret — the secret ends in the "secret" suffix,
 * so the settings suffix rule stores it encrypted at rest). When
 * either is absent the feature is OFF: the start route answers 503
 * NOT_CONFIGURED and the login page does not render the button (the
 * account page passes the availability flag down, exactly like
 * Google).
 *
 * EMAIL TRUST — the honest difference from Google: Facebook has no
 * email_verified flag. An email is present on the profile ONLY when
 * the customer granted the `email` permission AND the Facebook
 * account actually has a (confirmed) email address — Facebook never
 * returns one otherwise — so a returned email is the only
 * identifier we trust, and it is required: when Facebook returns NO
 * email, sign-in fails with EMAIL_MISSING and the callback lands on
 * /account?authError=facebook_no_email, which tells the customer to
 * use phone/OTP instead. We NEVER invent an identifier and NEVER
 * create an account without one.
 *
 * ACCOUNT BINDING — the SAME claim rules as googleId (schema wave 2):
 *   1. a row whose facebookId equals the profile `id` IS the
 *      account (its stored email follows the profile's email);
 *   2. otherwise a row matched by the returned email is claimed:
 *      facebookId is stamped onto it — a ONE-TIME claim, performed
 *      only while the row's facebookId is still null. If that row is
 *      already bound to a DIFFERENT facebookId, sign-in still
 *      proceeds (the email matched) but the binding is left
 *      untouched: one customer row never silently changes Facebook
 *      accounts;
 *   3. legacy rows are also found by their placeholder phone key
 *      `fb:<facebook id>` and claimed the same way;
 *   4. otherwise a fresh row is created with facebookId set.
 *
 * PHONE GAP (same as Google): Customer.phone is NOT NULL + unique
 * (the account key), and a Facebook-first customer has no phone.
 * Such rows are created with a non-dialable placeholder phone key
 * `fb:<facebook id>` — never a real-looking number, never accepted
 * by BD phone validation, so it can never receive an OTP or collide
 * with a real customer's number. toPublicCustomer renders its masked
 * form as "—".
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { toPublicCustomer, type PublicCustomer } from "./auth";

export const FACEBOOK_STATE_COOKIE = "facebook_oauth_state";
export const FACEBOOK_STATE_TTL_SECONDS = 600;

/** Pinned Graph API version for every Facebook endpoint below. */
const FACEBOOK_GRAPH_VERSION = "v21.0";
const FACEBOOK_AUTH_URL = `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`;
const FACEBOOK_TOKEN_URL = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`;
const FACEBOOK_PROFILE_URL = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`;

export interface FacebookAuthConfig {
  appId: string;
  appSecret: string;
}

/** Both credentials present in Settings, or the feature is off. */
export async function getFacebookAuthConfig(): Promise<FacebookAuthConfig | null> {
  const [appId, appSecret] = await Promise.all([
    getSetting("auth.facebook.app_id"),
    getSetting("auth.facebook.app_secret"),
  ]);
  const id = appId?.trim() ?? "";
  const secret = appSecret?.trim() ?? "";
  if (id === "" || secret === "") return null;
  return { appId: id, appSecret: secret };
}

/** Server-driven availability flag for the login UI. */
export async function isFacebookLoginConfigured(): Promise<boolean> {
  return (await getFacebookAuthConfig()) !== null;
}

/** Canonical public origin for the redirect URI (same pattern as
 *  Google: NEXT_PUBLIC_APP_URL, request origin as the local-dev
 *  fallback). The redirect URI must match the one registered in the
 *  Meta app's Facebook Login settings exactly. */
export function facebookAppBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env !== undefined && env !== "") return env.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export function facebookRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/v1/public/account/auth/facebook/callback`;
}

export function buildFacebookAuthorizationUrl(input: {
  appId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(FACEBOOK_AUTH_URL);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "public_profile,email");
  url.searchParams.set("state", input.state);
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Code exchange + profile fetch (fetch injectable for tests)         */
/* ------------------------------------------------------------------ */

export class FacebookAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "FacebookAuthError";
    this.code = code;
  }
}

type FetchFn = typeof fetch;

export async function exchangeFacebookCode(input: {
  code: string;
  config: FacebookAuthConfig;
  redirectUri: string;
  fetchFn?: FetchFn;
}): Promise<{ accessToken: string }> {
  const fetchFn = input.fetchFn ?? fetch;
  const url = new URL(FACEBOOK_TOKEN_URL);
  url.searchParams.set("client_id", input.config.appId);
  url.searchParams.set("client_secret", input.config.appSecret);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("code", input.code);
  let res: Response;
  try {
    res = await fetchFn(url.toString());
  } catch {
    throw new FacebookAuthError("EXCHANGE_FAILED", "Facebook token endpoint unreachable.");
  }
  const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!res.ok || json === null || typeof json.access_token !== "string" || json.access_token === "") {
    throw new FacebookAuthError("EXCHANGE_FAILED", "Facebook did not return an access_token.");
  }
  return { accessToken: json.access_token };
}

export interface FacebookProfile {
  email: string;
  name: string;
  /** Facebook's stable user id for this app. */
  id: string;
}

/**
 * Read the profile with the access token just exchanged. The email
 * is REQUIRED (see the header's trust note): Facebook omits it when
 * the permission was declined or the account has no confirmed
 * email, and in that case there is no trustworthy identifier to
 * bind an account to — EMAIL_MISSING fails the sign-in instead of
 * guessing.
 */
export async function fetchFacebookProfile(input: {
  accessToken: string;
  fetchFn?: FetchFn;
}): Promise<FacebookProfile> {
  const fetchFn = input.fetchFn ?? fetch;
  const url = new URL(FACEBOOK_PROFILE_URL);
  url.searchParams.set("fields", "id,name,email");
  url.searchParams.set("access_token", input.accessToken);
  let res: Response;
  try {
    res = await fetchFn(url.toString());
  } catch {
    throw new FacebookAuthError("PROFILE_FAILED", "Facebook profile endpoint unreachable.");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || json === null) {
    throw new FacebookAuthError("PROFILE_FAILED", "Facebook rejected the access token.");
  }
  const id = typeof json.id === "string" ? json.id.trim() : "";
  if (id === "") {
    throw new FacebookAuthError("ID_MISSING", "Facebook profile carries no user id.");
  }
  const email = typeof json.email === "string" ? json.email.trim().toLowerCase() : "";
  if (email === "") {
    throw new FacebookAuthError("EMAIL_MISSING", "Facebook did not return an email address.");
  }
  const name = typeof json.name === "string" && json.name.trim() !== "" ? json.name.trim() : "";
  return { email, name, id };
}

/* ------------------------------------------------------------------ */
/* Account binding — facebookId first, one-time email claim (header). */
/* ------------------------------------------------------------------ */

/** Placeholder phone key for a Facebook-first row (see header). */
export function facebookPlaceholderPhone(id: string): string {
  return `fb:${id}`;
}

export async function findOrCreateCustomerForFacebook(
  profile: FacebookProfile,
): Promise<PublicCustomer | null> {
  // 1) Bound row: facebookId is the durable identity.
  const byFacebookId = await prisma.customer.findUnique({
    where: { facebookId: profile.id },
  });
  if (byFacebookId !== null) {
    if (byFacebookId.blocked || byFacebookId.deletedAt !== null) return null;
    const updated = await prisma.customer.update({
      where: { id: byFacebookId.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // Follow the profile's current email, exactly like the
        // Google binding follows the verified email.
        email: profile.email,
      },
    });
    return toPublicCustomer(updated);
  }

  // 2) + 3) Unbound row found by the returned email, or a legacy
  // row found by its placeholder phone key: claim it.
  const byEmail = await prisma.customer.findFirst({ where: { email: profile.email } });
  const placeholder = facebookPlaceholderPhone(profile.id);
  const candidate =
    byEmail ??
    (await prisma.customer.findUnique({ where: { phone: placeholder } }));
  if (candidate !== null) {
    if (candidate.blocked || candidate.deletedAt !== null) return null;
    const updated = await prisma.customer.update({
      where: { id: candidate.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // A legacy row found by its placeholder key follows the
        // newly returned email; an email-matched row already has it.
        ...(byEmail === null ? { email: profile.email } : {}),
        // ONE-TIME CLAIM: stamp only while unbound. A row already
        // bound to a different facebookId keeps that binding (header).
        ...(candidate.facebookId === null ? { facebookId: profile.id } : {}),
      },
    });
    return toPublicCustomer(updated);
  }

  // 4) Brand-new Facebook-first customer.
  const created = await prisma.customer.create({
    data: {
      name: profile.name !== "" ? profile.name : profile.email.split("@")[0] ?? "গ্রাহক",
      phone: placeholder,
      email: profile.email,
      facebookId: profile.id,
      passwordHash: null,
      tags: [],
    },
  });
  return toPublicCustomer(created);
}
