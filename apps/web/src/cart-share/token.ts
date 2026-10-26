/**
 * Cart-share tokens — ADV-19 (doc 22). A guest cart can be shared as a
 * link (/cart/shared?t=<token>) with NO server persistence: the token
 * IS the share. It carries ONLY { variantId, quantity } lines plus an
 * expiry, HMAC-SHA256-signed with the same server secret the portal
 * sessions use (AUTH_ENCRYPTION_KEY / SETTINGS_ENCRYPTION_KEY — see
 * src/reseller/portal-auth.ts for the pattern).
 *
 * Prices and stock are NEVER in the token and never trusted from it:
 * the shared page re-resolves every line against the live catalog.
 * Tampered tokens fail the signature check; expired tokens fail the
 * exp check — both surface as a clear error on the shared page.
 *
 * Server-only module (reads env secrets). The mint endpoint is
 * POST /api/v1/public/cart-share; verification happens in the /cart/
 * shared server page.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { addQty, isValidQtyNumber } from "../lib/quantity";

export const CART_SHARE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const CART_SHARE_MAX_LINES = 50;

export interface CartShareLine {
  variantId: string;
  quantity: number;
}

interface CartSharePayload {
  v: 1;
  lines: { v: string; q: number }[];
  exp: number;
}

function shareSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when sharing can be signed at all (a signing key exists). */
export function isCartShareConfigured(): boolean {
  return shareSecret() !== null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/** Normalise untrusted line input: string variant ids, quantities
 *  1–999 (fractional allowed since wave 59 — a shared weighted line
 *  must survive the round trip; checkout re-gates fractions to
 *  weighted variants), duplicates merged, capped at MAX_LINES.
 *  Returns null when nothing usable remains. */
export function normalizeShareLines(input: unknown): CartShareLine[] | null {
  if (!Array.isArray(input)) return null;
  const byVariant = new Map<string, number>();
  for (const entry of input as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const { variantId, quantity } = entry as { variantId?: unknown; quantity?: unknown };
    if (typeof variantId !== "string" || variantId.trim() === "" || variantId.length > 128) continue;
    if (typeof quantity !== "number" || !isValidQtyNumber(quantity) || quantity > 999) continue;
    byVariant.set(variantId, Math.min(999, addQty(byVariant.get(variantId) ?? 0, quantity)));
  }
  if (byVariant.size === 0 || byVariant.size > CART_SHARE_MAX_LINES) return null;
  return [...byVariant.entries()].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function createCartShareToken(
  lines: CartShareLine[],
  nowMs: number = Date.now(),
): string | null {
  const secret = shareSecret();
  if (!secret) return null;
  const clean = normalizeShareLines(lines);
  if (!clean) return null;
  const payload: CartSharePayload = {
    v: 1,
    lines: clean.map((l) => ({ v: l.variantId, q: l.quantity })),
    exp: nowMs + CART_SHARE_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type CartShareVerify =
  | { ok: true; lines: CartShareLine[]; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" | "not_configured" };

export function verifyCartShareToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): CartShareVerify {
  if (!token) return { ok: false, reason: "invalid" };
  const secret = shareSecret();
  if (!secret) return { ok: false, reason: "not_configured" };
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { ok: false, reason: "invalid" };
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as CartSharePayload;
    if (payload.v !== 1 || typeof payload.exp !== "number" || !Array.isArray(payload.lines)) {
      return { ok: false, reason: "invalid" };
    }
    if (payload.exp <= nowMs) return { ok: false, reason: "expired" };
    const lines = normalizeShareLines(
      payload.lines.map((l) => ({ variantId: l?.v, quantity: l?.q })),
    );
    if (!lines) return { ok: false, reason: "invalid" };
    return { ok: true, lines, expiresAt: payload.exp };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
