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
 * httpOnly cookie. v1 deliberately keeps NO session table — the
 * token carries only { rid, exp } and is verified purely. Trade-off,
 * stated honestly: a token cannot be revoked server-side before its
 * 7-day expiry; logout clears the cookie. A DB session table (like
 * customer sessions) is the v2 upgrade if revocation is needed.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

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
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createResellerSessionToken(resellerId: string, nowMs: number = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload: SessionPayload = { rid: resellerId, exp: nowMs + RESELLER_SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify a session token; returns the reseller id or null (bad sig / expired / malformed). */
export function verifyResellerSessionToken(token: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!token) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.rid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= nowMs) return null;
    return payload.rid;
  } catch {
    return null;
  }
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
