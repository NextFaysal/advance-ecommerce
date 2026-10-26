/**
 * Contact form — spam / rate-limit policy. Agent 47. Pure logic.
 *
 * Two independent defences for the public endpoint:
 *
 * 1. HONEYPOT — a hidden `website` field (see schema.ts). If it arrives
 *    filled, the submission is a bot's: the route returns the normal
 *    201 shape (with a reference id that was never stored), stores
 *    NOTHING, and silently increments the drop counter in store.ts.
 *    The response never reveals that a honeypot exists.
 *
 * 2. RATE LIMIT — max 3 submissions per hour per (normalized phone +
 *    IP) pair. The public endpoint checks through the shared
 *    Redis-backed limiter (src/lib/rate-limit.ts) via
 *    checkContactRateLimit in src/contact/rate-limit.ts — counts hold
 *    across instances. The IP is a PLACEHOLDER: the route passes the
 *    first x-forwarded-for hop (or "unknown") until a trusted-proxy
 *    setup exists. The honeypot check is stateless.
 *
 * (This module once also carried an in-memory ContactRateLimiter
 * class; its last consumer — the abandoned-checkout capture limiter
 * in src/checkout/abandoned.ts — migrated to the shared limiter in
 * wave 54, and the class was deleted with it.)
 */
// This policy module must stay free of server-only dependencies
// (client forms import its constants). The Redis-backed rate check
// lives in src/contact/rate-limit.ts.
import { CONTACT_HONEYPOT_FIELD } from "./schema";

export const CONTACT_RATE_LIMIT = {
  maxSubmissions: 3,
  windowMs: 60 * 60_000, // 1 hour
} as const;

/** True when the honeypot field arrived filled with a non-empty string. */
export function isHoneypotTripped(rawBody: unknown): boolean {
  if (typeof rawBody !== "object" || rawBody === null) return false;
  const value = (rawBody as Record<string, unknown>)[CONTACT_HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

/** Rate-limit key: normalized phone + (placeholder) IP. */
export function contactRateLimitKey(normalizedPhone: string, ip: string): string {
  return `${normalizedPhone}|${ip}`;
}

/* The rate check itself lives in src/contact/rate-limit.ts
 * (server-only — it loads the Redis limiter; this policy module is
 * imported by client code and must stay dependency-free). */
