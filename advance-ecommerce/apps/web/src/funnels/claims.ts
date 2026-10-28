/**
 * Funnel order-step claims — doc 34 §3.7 (wave L7).
 *
 * Two render-issued signed claims ride the EXISTING public orders
 * POST from a funnel order step's QuickOrderForm. Both are stateless
 * HMAC tokens in the platform's pattern family (theme preview
 * grants, src/funnels/token.ts — the L8 continuation token):
 *
 *   token = base64url(JSON payload) + "." + base64url(HMAC-SHA256)
 *
 * Secret: AUTH_ENCRYPTION_KEY, falling back to
 * SETTINGS_ENCRYPTION_KEY. No secret configured → nothing can be
 * minted or verified (fail closed): the form then renders without
 * funnel claims and the order is a plain landing order.
 *
 *   1. BUMP claim — `{ funnelId, stepId, variantId, discountRule }`
 *      (§3.7 verbatim). Sent ONLY when the customer ticks the bump
 *      card. It is a CLAIM, never a price: the orders route re-loads
 *      the funnel, re-checks the rule against the step's CURRENT
 *      stored bump, resolves the LIVE catalog price and computes
 *      the discounted line itself. A claim that fails ANY check
 *      drops the bump line — the order itself never fails over a
 *      bump (§3.7: "a broken bump must never lose a sale").
 *
 *   2. CONTEXT claim — `{ funnelId, stepId }`. Sent on EVERY funnel
 *      order-step submit (bump ticked or not). It is what lets the
 *      orders route attribute the order to the funnel (§3.8) and
 *      issue the §3.7 continuation (next-step URL + the L8 funnel
 *      token) even when no bump exists or the bump was not taken.
 *      An invalid context claim drops attribution/continuation only,
 *      never the order.
 *
 * Expiry: 24h for both — defence in depth only. The authoritative
 * checks are the server-side re-load + rule re-check at order time;
 * the window just bounds how long a rendered page's claims stay
 * usable (a landing tab left open overnight still orders fine —
 * without funnel context once the claims lapse).
 *
 * Server-only module (reads env secrets). Do NOT import from client
 * components — the form receives the minted STRINGS as props.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { OfferDiscount } from "./types";

export const BUMP_CLAIM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const FUNNEL_CONTEXT_CLAIM_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface BumpClaimPayload {
  v: 1;
  kind: "bump";
  funnelId: string;
  stepId: string;
  /** The variant the render resolved for the bump (the pinned
   *  variant, or the live pick at render time). The server still
   *  re-validates it against the stored bump + live catalog. */
  variantId: string | null;
  /** The discount RULE as stored on the step at render time — the
   *  server requires it to still deep-equal the stored rule. */
  discount: OfferDiscount | null;
  /** Expiry, epoch ms. */
  exp: number;
}

export interface FunnelContextClaimPayload {
  v: 1;
  kind: "ctx";
  funnelId: string;
  stepId: string;
  /** Expiry, epoch ms. */
  exp: number;
}

function funnelSecret(): string | null {
  return process.env.AUTH_ENCRYPTION_KEY ?? process.env.SETTINGS_ENCRYPTION_KEY ?? null;
}

/** True when claims can be minted/verified at all (a signing key exists). */
export function isFunnelClaimConfigured(): boolean {
  return funnelSecret() !== null;
}

function sign(payloadB64: string, secret: string): string {
  return createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

function mint(payload: object): string | null {
  const secret = funnelSecret();
  if (!secret) return null;
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verify signature (timing-safe) + expiry; returns the raw payload
 *  for the caller's per-kind shape check, or null. */
function verifyRaw(token: string | null | undefined, nowMs: number): Record<string, unknown> | null {
  if (!token) return null;
  const secret = funnelSecret();
  if (!secret) return null;
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (payload.v !== 1 || typeof payload.exp !== "number" || payload.exp <= nowMs) return null;
  return payload;
}

function isOfferDiscount(value: unknown): value is OfferDiscount | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const d = value as { kind?: unknown; pct?: unknown; poisha?: unknown };
  if (d.kind === "percent") {
    return typeof d.pct === "number" && Number.isInteger(d.pct) && d.pct >= 1 && d.pct <= 90;
  }
  if (d.kind === "fixed") {
    return typeof d.poisha === "number" && Number.isInteger(d.poisha) && d.poisha >= 1;
  }
  return false;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** Mint the §3.7 bump claim for one rendered order step. Null when
 *  no signing secret is configured (the card then cannot be offered
 *  with a claim — the step page omits the bump entirely). */
export function createBumpClaim(
  input: { funnelId: string; stepId: string; variantId: string | null; discount: OfferDiscount | null },
  nowMs: number = Date.now(),
): string | null {
  if (!input.funnelId || !input.stepId) return null;
  const payload: BumpClaimPayload = {
    v: 1,
    kind: "bump",
    funnelId: input.funnelId,
    stepId: input.stepId,
    variantId: input.variantId,
    discount: input.discount,
    exp: nowMs + BUMP_CLAIM_TTL_MS,
  };
  return mint(payload);
}

/** Verify a bump claim: signature + shape + expiry. Null on ANY
 *  failure — callers drop the bump line and keep the order. */
export function verifyBumpClaim(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): BumpClaimPayload | null {
  const payload = verifyRaw(token, nowMs);
  if (!payload || payload.kind !== "bump") return null;
  if (!isNonEmptyString(payload.funnelId) || !isNonEmptyString(payload.stepId)) return null;
  if (!(payload.variantId === null || isNonEmptyString(payload.variantId))) return null;
  if (!isOfferDiscount(payload.discount)) return null;
  return payload as unknown as BumpClaimPayload;
}

/** Mint the funnel context claim (attribution + continuation). */
export function createFunnelContextClaim(
  input: { funnelId: string; stepId: string },
  nowMs: number = Date.now(),
): string | null {
  if (!input.funnelId || !input.stepId) return null;
  const payload: FunnelContextClaimPayload = {
    v: 1,
    kind: "ctx",
    funnelId: input.funnelId,
    stepId: input.stepId,
    exp: nowMs + FUNNEL_CONTEXT_CLAIM_TTL_MS,
  };
  return mint(payload);
}

/** Verify a funnel context claim: signature + shape + expiry. */
export function verifyFunnelContextClaim(
  token: string | null | undefined,
  nowMs: number = Date.now(),
): FunnelContextClaimPayload | null {
  const payload = verifyRaw(token, nowMs);
  if (!payload || payload.kind !== "ctx") return null;
  if (!isNonEmptyString(payload.funnelId) || !isNonEmptyString(payload.stepId)) return null;
  return payload as unknown as FunnelContextClaimPayload;
}
