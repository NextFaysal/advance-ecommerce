/**
 * Funnel continuation token — doc 34 §3.7 (wave L8).
 *
 * After a funnel's order step creates an order, the flow continues
 * at /f/<slug>/<stepId>?t=<token>. The token is a STATELESS signed
 * claim in the platform's existing pattern family (cart-share
 * tokens, theme preview grants):
 *
 *   token = base64url(JSON { v, funnelId, orderId, exp })
 *           + "." + base64url(HMAC-SHA256(payloadB64, secret))
 *
 * Secret: AUTH_ENCRYPTION_KEY, falling back to
 * SETTINGS_ENCRYPTION_KEY. No secret configured → nothing can be
 * minted or verified (fail closed, like the portals).
 *
 * The token carries IDS ONLY — never order data, never prices. It
 * proves "this browser flow belongs to funnel F for order O"; the
 * amend endpoint additionally re-proves ownership by matching the
 * order number in the URL + the customer's phone against the order
 * row (§3.7).
 *
 * Expiry IS the §5.4 amend window: tokens are minted for 60
 * minutes, and the amend service ALSO checks the order's own age
 * against the same window (whichever ends first governs).
 *
 * L7's order-success redirect mints with createFunnelToken; the L8
 * step pages + amend endpoint verify with verifyFunnelToken — one
 * module, so the two waves can never drift on format.
 *
 * Server-only module (reads env secrets). Do NOT import from
 * client components.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** §5.4 default: the post-order offer window. */
export const FUNNEL_TOKEN_TTL_MS = 60 * 60 * 1000; // 60 minutes

export interface FunnelTokenPayload {
  v: 1;
  funnelId: string;
  orderId: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function funnelSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when funnel tokens can be minted/verified at all. */
export function isFunnelTokenConfigured(): boolean {
  return funnelSecret() !== null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

/**
 * Mint the continuation token for a freshly created funnel order.
 * Returns null when no signing secret is configured (callers must
 * degrade to the plain thank-you path — never mint an unverifiable
 * token).
 */
export function createFunnelToken(
  input: { funnelId: string; orderId: string },
  nowMs: number = Date.now(),
): string | null {
  const secret = funnelSecret();
  if (!secret) return null;
  if (!input.funnelId || !input.orderId) return null;
  const payload: FunnelTokenPayload = {
    v: 1,
    funnelId: input.funnelId,
    orderId: input.orderId,
    exp: nowMs + FUNNEL_TOKEN_TTL_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

export type FunnelTokenVerify =
  | { ok: true; funnelId: string; orderId: string; expiresAt: number }
  | { ok: false; reason: "invalid" | "expired" | "not_configured" };

/** Verify a continuation token: signature (timing-safe) + shape + expiry. */
export function verifyFunnelToken(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): FunnelTokenVerify {
  if (!token) return { ok: false, reason: "invalid" };
  const secret = funnelSecret();
  if (!secret) return { ok: false, reason: "not_configured" };
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return { ok: false, reason: "invalid" };
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "invalid" };
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as FunnelTokenPayload;
    if (
      payload.v !== 1 ||
      typeof payload.funnelId !== "string" ||
      payload.funnelId === "" ||
      typeof payload.orderId !== "string" ||
      payload.orderId === "" ||
      typeof payload.exp !== "number"
    ) {
      return { ok: false, reason: "invalid" };
    }
    if (payload.exp <= nowMs) return { ok: false, reason: "expired" };
    return { ok: true, funnelId: payload.funnelId, orderId: payload.orderId, expiresAt: payload.exp };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
