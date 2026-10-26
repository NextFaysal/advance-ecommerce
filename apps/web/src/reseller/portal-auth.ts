/**
 * Reseller portal auth — ADV-12 v1.
 *
 * Credential: the reseller signs in with their phone number + their
 * public attribution code (the code is the shared secret for v1 —
 * it is what the reseller already guards as their earning identity).
 * The submitted code is compared against the stored code by hashing
 * BOTH sides with SHA-256 and timingSafeEqual on the digests, so the
 * comparison leaks neither length nor prefix timing.
 *
 * Session: a stateless signed token (HMAC-SHA256 over a JSON payload,
 * keyed with AUTH_ENCRYPTION_KEY / SETTINGS_ENCRYPTION_KEY) in an
 * httpOnly cookie. There is still NO session table — the token
 * carries { rid, exp, v }.
 *
 * Revocation (doc 23 wave 54-7): `v` is the reseller portal's token
 * version at issuance, read from the `portal.token_versions`
 * Setting document (src/lib/portal-token-versions.ts). Verification
 * compares it against the CURRENT stored version, so the admin
 * action POST /api/v1/admin/resellers/revoke-sessions — which
 * increments the counter — kills every outstanding reseller token
 * at once on its next request. Tokens issued before the version
 * mechanism existed carry no `v`: they count as version 0 and stay
 * valid ONLY while the counter is still 0, so the first bump
 * retires them too (no grandfathering past an emergency revoke).
 * What still does NOT exist: revoking ONE token — logout clears
 * the cookie, and individual sessions remain unrevocable until
 * expiry or a portal-wide bump. A DB session table (like customer
 * sessions) remains the upgrade if per-token revocation is needed.
 * Because verification now reads the counter, create/verify are
 * async; a counter read failure fails closed (verify → null,
 * create → null) rather than honouring an uncheckable token.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPortalTokenVersion } from "../lib/portal-token-versions";

export const RESELLER_SESSION_COOKIE = "reseller_session";
export const RESELLER_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function sessionSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when the portal can issue sessions at all (a signing key exists). */
export function isPortalAuthConfigured(): boolean {
  return sessionSecret() !== null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Timing-safe comparison of a submitted reseller code vs the stored one. */
export function verifyResellerCode(storedCode: string | null | undefined, submitted: string): boolean {
  if (!storedCode || !submitted) return false;
  const a = Buffer.from(sha256Hex(storedCode.trim().toUpperCase()), "hex");
  const b = Buffer.from(sha256Hex(submitted.trim().toUpperCase()), "hex");
  return timingSafeEqual(a, b);
}

interface SessionPayload {
  rid: string;
  exp: number;
  /** Portal token version at issuance (wave 54-7). Absent on tokens
   *  issued before the version mechanism existed — those count as
   *  version 0 at verification time. */
  v?: number;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export async function createResellerSessionToken(resellerId: string, nowMs: number = Date.now()): Promise<string | null> {
  const secret = sessionSecret();
  if (!secret) return null;
  let version: number;
  try {
    version = await getPortalTokenVersion("reseller");
  } catch {
    // Fail closed: never mint a token we cannot version-stamp.
    return null;
  }
  const payload: SessionPayload = { rid: resellerId, exp: nowMs + RESELLER_SESSION_TTL_MS, v: version };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify a session token; returns the reseller id or null (bad sig /
 *  expired / malformed / revoked by a portal token-version bump /
 *  version counter unreadable). */
export async function verifyResellerSessionToken(token: string | null | undefined, nowMs: number = Date.now()): Promise<string | null> {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.rid !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp <= nowMs) return null;
  let currentVersion: number;
  try {
    currentVersion = await getPortalTokenVersion("reseller");
  } catch {
    // Fail closed: a token that cannot be checked against the
    // revocation counter is not honoured.
    return null;
  }
  const tokenVersion = typeof payload.v === "number" ? payload.v : 0;
  if (tokenVersion !== currentVersion) return null;
  return payload.rid;
}

export function resellerSessionCookieOptions(maxAgeSeconds: number): {
  httpOnly: true;
  sameSite: "lax";
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSeconds,
  };
}
