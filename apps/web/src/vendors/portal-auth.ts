/**
 * Vendor portal auth — ADV-13 (doc 22).
 *
 * Credential: the Vendor row carries NO password/code field (schema
 * audit, 2026-10-26: Vendor = name / ownerName / phone / email /
 * commissionBps / status only). So the portal credential is the
 * vendor's phone number + a one-time code, issued and verified by
 * src/vendors/portal-otp.ts (which mirrors the order-OTP discipline
 * of src/orders/otp.ts: hash-only storage, 6 digits, 10-minute TTL,
 * 5 attempts). The code is delivered over the existing sms-send
 * queue — see portal-otp.ts for the delivery honesty notes.
 *
 * Session: a stateless signed token (HMAC-SHA256 over a JSON payload,
 * keyed with AUTH_ENCRYPTION_KEY / SETTINGS_ENCRYPTION_KEY) in an
 * httpOnly cookie — the exact pattern of the reseller portal
 * (src/reseller/portal-auth.ts). v1 keeps NO session table; the
 * token carries only { vid, exp }. Trade-off, stated honestly: a
 * token cannot be revoked server-side before its 7-day expiry;
 * logout clears the cookie.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { featureFlags } from "../lib/feature-flags";

export const VENDOR_SESSION_COOKIE = "vendor_session";
export const VENDOR_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Portal gate: module.vendor_portal (seeded OFF) is its OWN flag, so
 * an install can run the admin multi-vendor module without exposing
 * vendor logins. Read through the unified flag store — the same
 * store the feature-flags API PATCHes.
 */
export function isVendorPortalEnabled(): boolean {
  return featureFlags.isFeatureEnabled("module.vendor_portal");
}

function sessionSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when the portal can issue sessions at all (a signing key exists). */
export function isVendorPortalAuthConfigured(): boolean {
  return sessionSecret() !== null;
}

interface SessionPayload {
  vid: string;
  exp: number;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createVendorSessionToken(vendorId: string, nowMs: number = Date.now()): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload: SessionPayload = { vid: vendorId, exp: nowMs + VENDOR_SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify a session token; returns the vendor id or null (bad sig / expired / malformed). */
export function verifyVendorSessionToken(token: string | null | undefined, nowMs: number = Date.now()): string | null {
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
    if (typeof payload.vid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp <= nowMs) return null;
    return payload.vid;
  } catch {
    return null;
  }
}

export function vendorSessionCookieOptions(maxAgeSeconds: number): {
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
