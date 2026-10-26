/**
 * Customer Google sign-in — doc 22 ADV-15 (spec §1).
 *
 * Plain OAuth 2.0 authorization-code flow over fetch (no new deps):
 *   start route    → 302 to Google with a random `state` kept in an
 *                    httpOnly cookie;
 *   callback route → code exchanged at oauth2.googleapis.com/token,
 *                    the id_token verified through Google's tokeninfo
 *                    endpoint: audience MUST equal our client id and
 *                    email_verified MUST be "true" — an unverified or
 *                    foreign-audience token never signs anyone in.
 *
 * Configuration lives in Settings (auth.google.client_id /
 * auth.google.client_secret — the secret is encrypted at rest by the
 * settings suffix rule). When either is absent the feature is OFF:
 * the start route answers 503 NOT_CONFIGURED and the login page does
 * not render the button (the account page passes the availability
 * flag down, the payment-methods capability pattern).
 *
 * ACCOUNT BINDING (no migration in this wave): there is no googleId
 * column on Customer, so binding is by the VERIFIED email — an
 * existing Customer with that email is the account, whatever sign-in
 * method created it. GAP, reported: without googleId, a customer who
 * changes their Google email address would bind to a different (or
 * new) account; a future schema wave should add Customer.googleId
 * and bind on it.
 *
 * PHONE GAP (same wave constraint): Customer.phone is NOT NULL +
 * unique (it is the account key), and a Google-first customer has no
 * phone. Such rows are created with a non-dialable placeholder phone
 * key `g:<google sub>` — never a real-looking number, never accepted
 * by BD phone validation, so it can never receive an OTP or collide
 * with a real customer's number. toPublicCustomer renders its masked
 * form as "—". The customer gains full phone-keyed behaviour once a
 * real phone is attached (no self-serve UI for that yet).
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { toPublicCustomer, type PublicCustomer } from "./auth";

export const GOOGLE_STATE_COOKIE = "google_oauth_state";
export const GOOGLE_STATE_TTL_SECONDS = 600;

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo";

export interface GoogleAuthConfig {
  clientId: string;
  clientSecret: string;
}

/** Both credentials present in Settings, or the feature is off. */
export async function getGoogleAuthConfig(): Promise<GoogleAuthConfig | null> {
  const [clientId, clientSecret] = await Promise.all([
    getSetting("auth.google.client_id"),
    getSetting("auth.google.client_secret"),
  ]);
  const id = clientId?.trim() ?? "";
  const secret = clientSecret?.trim() ?? "";
  if (id === "" || secret === "") return null;
  return { clientId: id, clientSecret: secret };
}

/** Server-driven availability flag for the login UI. */
export async function isGoogleLoginConfigured(): Promise<boolean> {
  return (await getGoogleAuthConfig()) !== null;
}

/** Canonical public origin for the redirect URI (the payments
 *  initiate pattern: NEXT_PUBLIC_APP_URL, request origin as the
 *  local-dev fallback). The redirect URI must match the one
 *  registered in the Google Cloud console exactly. */
export function googleAppBaseUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env !== undefined && env !== "") return env.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export function googleRedirectUri(baseUrl: string): string {
  return `${baseUrl}/api/v1/public/account/auth/google/callback`;
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", input.state);
  url.searchParams.set("access_type", "online");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/* ------------------------------------------------------------------ */
/* Code exchange + id_token verification (fetch injectable for tests) */
/* ------------------------------------------------------------------ */

export class GoogleAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

type FetchFn = typeof fetch;

export async function exchangeGoogleCode(input: {
  code: string;
  config: GoogleAuthConfig;
  redirectUri: string;
  fetchFn?: FetchFn;
}): Promise<{ idToken: string }> {
  const fetchFn = input.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: input.code,
        client_id: input.config.clientId,
        client_secret: input.config.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: "authorization_code",
      }),
    });
  } catch {
    throw new GoogleAuthError("EXCHANGE_FAILED", "Google token endpoint unreachable.");
  }
  const json = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!res.ok || json === null || typeof json.id_token !== "string" || json.id_token === "") {
    throw new GoogleAuthError("EXCHANGE_FAILED", "Google did not return an id_token.");
  }
  return { idToken: json.id_token };
}

export interface GoogleProfile {
  email: string;
  name: string;
  /** Google's stable subject id for this user. */
  sub: string;
}

/**
 * Verify an id_token via Google's tokeninfo endpoint. Audience and
 * email_verified are enforced HERE — tokeninfo alone only says the
 * token is genuine, not that it was minted for THIS app or that
 * Google has verified the mailbox.
 */
export async function fetchGoogleIdTokenProfile(input: {
  idToken: string;
  clientId: string;
  fetchFn?: FetchFn;
}): Promise<GoogleProfile> {
  const fetchFn = input.fetchFn ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(`${GOOGLE_TOKENINFO_URL}?id_token=${encodeURIComponent(input.idToken)}`);
  } catch {
    throw new GoogleAuthError("TOKENINFO_FAILED", "Google tokeninfo endpoint unreachable.");
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || json === null) {
    throw new GoogleAuthError("TOKENINFO_FAILED", "Google rejected the id_token.");
  }
  if (json.aud !== input.clientId) {
    throw new GoogleAuthError("AUDIENCE_MISMATCH", "id_token was not issued for this app.");
  }
  const email = typeof json.email === "string" ? json.email.trim().toLowerCase() : "";
  if (email === "") {
    throw new GoogleAuthError("EMAIL_MISSING", "id_token carries no email.");
  }
  if (json.email_verified !== "true" && json.email_verified !== true) {
    throw new GoogleAuthError("EMAIL_UNVERIFIED", "Google has not verified this email.");
  }
  const sub =
    typeof json.sub === "string" && json.sub !== ""
      ? json.sub
      : typeof json.user_id === "string" && json.user_id !== ""
        ? json.user_id
        : "";
  if (sub === "") {
    throw new GoogleAuthError("SUB_MISSING", "id_token carries no subject id.");
  }
  const name = typeof json.name === "string" && json.name.trim() !== "" ? json.name.trim() : "";
  return { email, name, sub };
}

/* ------------------------------------------------------------------ */
/* Account binding — by verified email (see the header for the gap).  */
/* ------------------------------------------------------------------ */

/** Placeholder phone key for a Google-first row (see header). */
export function googlePlaceholderPhone(sub: string): string {
  return `g:${sub}`;
}

export async function findOrCreateCustomerForGoogle(
  profile: GoogleProfile,
): Promise<PublicCustomer | null> {
  const byEmail = await prisma.customer.findFirst({ where: { email: profile.email } });
  const placeholder = googlePlaceholderPhone(profile.sub);
  const existing =
    byEmail ??
    (await prisma.customer.findUnique({ where: { phone: placeholder } }));
  if (existing !== null) {
    if (existing.blocked || existing.deletedAt !== null) return null;
    const updated = await prisma.customer.update({
      where: { id: existing.id },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        // A row found by its placeholder key whose email changed on
        // Google's side follows the newly verified email.
        ...(byEmail === null ? { email: profile.email } : {}),
      },
    });
    return toPublicCustomer(updated);
  }
  const created = await prisma.customer.create({
    data: {
      name: profile.name !== "" ? profile.name : profile.email.split("@")[0] ?? "গ্রাহক",
      phone: placeholder,
      email: profile.email,
      passwordHash: null,
      tags: [],
    },
  });
  return toPublicCustomer(created);
}
