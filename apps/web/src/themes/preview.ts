/**
 * Theme preview grant — doc 25 §2.3 (D4), S0 scope.
 *
 * A preview grant lets a signed-in staff member preview a catalog
 * theme instance on the real storefront. The grant is a STATELESS
 * signed token in an HttpOnly cookie — the exact pattern of the
 * vendor/reseller portal sessions (src/vendors/portal-auth.ts):
 *
 *   token = base64url(JSON { instanceId, staffId, exp })
 *           + "." + base64url(HMAC-SHA256(payloadB64, secret))
 *
 * Secret: AUTH_ENCRYPTION_KEY, falling back to
 * SETTINGS_ENCRYPTION_KEY (the portal sessions' secret source). No
 * secret configured → no grant can be minted or verified (fail
 * closed, like the portals).
 *
 * DEVIATION from doc 25 §2.3 (recorded in the S0 report): the doc
 * sketches server-side grant rows in a `theme.preview_grants` Setting
 * doc with the cookie carrying only a grantId. S0 ships the stateless
 * signed grant instead — the codebase's proven pattern for exactly
 * this shape of credential. Consequences: there is no server-side
 * per-grant revocation list; a grant dies by expiry (30 min), by the
 * browser clearing the cookie (preview DELETE route), or by secret
 * rotation. Staff binding is enforced at read time: getPreviewGrant
 * compares the grant's staffId against the caller's current staff id.
 *
 * NEVER honoured: a bare ?theme_preview= query param. Nothing in this
 * module (or anywhere) reads one — the cookie, minted only by the
 * admin POST route, is the sole carrier.
 *
 * S0 scope: mint + verify + cookie read only. The grant is NOT wired
 * into storefront rendering yet — S3's shell wrapper consumes
 * getPreviewGrant() and switches that request to dynamic rendering.
 *
 * Server-side only — imports next/headers; do NOT import from client
 * components.
 */
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

export const THEME_PREVIEW_COOKIE = "ae_theme_preview";
export const THEME_PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 minutes (doc 25 §2.3)

export interface ThemePreviewGrant {
  /** Catalog instance (AppTheme) id being previewed. */
  instanceId: string;
  /** Staff user id the grant was minted for — binding checked on read. */
  staffId: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function previewSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when grants can be minted/verified at all (a signing key exists). */
export function isThemePreviewConfigured(): boolean {
  return previewSecret() !== null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Mint a signed preview grant token. Returns null when no signing
 * secret is configured (the route surfaces that as 503 — never mint
 * an unverifiable grant).
 */
export function createThemePreviewGrant(
  instanceId: string,
  staffId: string,
  nowMs: number = Date.now(),
): string | null {
  const secret = previewSecret();
  if (!secret) return null;
  const payload: ThemePreviewGrant = {
    instanceId,
    staffId,
    exp: nowMs + THEME_PREVIEW_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/**
 * Verify a grant token: constant-time signature comparison, payload
 * shape, and expiry. Pure (no cookie access) so it is unit-verifiable.
 * Returns the grant or null — every failure mode is null.
 */
export function verifyThemePreviewGrant(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): ThemePreviewGrant | null {
  if (!token) return null;
  const secret = previewSecret();
  if (!secret) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: ThemePreviewGrant;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as ThemePreviewGrant;
  } catch {
    return null;
  }
  if (
    typeof payload.instanceId !== "string" ||
    typeof payload.staffId !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (payload.exp <= nowMs) return null;
  return payload;
}

/**
 * Read + verify the preview grant from the current request's cookie.
 *
 * Pass `currentStaffId` (the staff id from the request's validated
 * admin session) to enforce the staff binding: a grant minted for a
 * different staff member is NOT honoured. Callers without a staff
 * session at hand (none in S0 — S3's shell wrapper validates the
 * session first) may omit it and get signature+expiry checks only.
 */
export function getPreviewGrant(currentStaffId?: string): ThemePreviewGrant | null {
  const token = cookies().get(THEME_PREVIEW_COOKIE)?.value;
  const grant = verifyThemePreviewGrant(token);
  if (!grant) return null;
  if (currentStaffId !== undefined && grant.staffId !== currentStaffId) return null;
  return grant;
}

/** Cookie options mirroring the portal sessions' discipline. */
export function themePreviewCookieOptions(maxAgeSeconds: number): {
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
