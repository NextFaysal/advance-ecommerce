/**
 * Newsletter subscribe — spam / rate-limit policy. Pure logic.
 *
 * Mirrors src/contact/policy.ts (the house pattern for public forms):
 *
 * 1. HONEYPOT — a hidden `website` field (see the form component). If
 *    it arrives filled, the submission is a bot's: the route returns
 *    the normal 201 shape, stores NOTHING, and silently counts the
 *    drop. The response never reveals that a honeypot exists.
 *
 * 2. RATE LIMIT — max 5 attempts per hour per (email + IP) pair,
 *    counted through the shared Redis-backed limiter
 *    (src/lib/rate-limit.ts) via checkNewsletterRateLimit below — one
 *    bucket shared by the subscribe (POST) and unsubscribe (DELETE)
 *    handlers, as before. The IP is a PLACEHOLDER: the route passes
 *    the first x-forwarded-for hop (or "unknown") until a trusted-
 *    proxy setup exists.
 */
// This module is imported by the client NewsletterForm (honeypot
// constant), so it must stay free of server-only dependencies. The
// Redis-backed rate check lives in src/newsletter/rate-limit.ts.

export const NEWSLETTER_HONEYPOT_FIELD = "website";

export const NEWSLETTER_RATE_LIMIT = {
  maxAttempts: 5,
  windowMs: 60 * 60_000, // 1 hour
} as const;

/** True when the honeypot field arrived filled with a non-empty string. */
export function isNewsletterHoneypotTripped(rawBody: unknown): boolean {
  if (typeof rawBody !== "object" || rawBody === null) return false;
  const value = (rawBody as Record<string, unknown>)[NEWSLETTER_HONEYPOT_FIELD];
  return typeof value === "string" && value.trim().length > 0;
}

/** Rate-limit key: normalized email + (placeholder) IP. */
export function newsletterRateLimitKey(normalizedEmail: string, ip: string): string {
  return `${normalizedEmail}|${ip}`;
}

/* The rate check itself lives in src/newsletter/rate-limit.ts
 * (server-only — it loads the Redis limiter; this policy module is
 * imported by a client form and must stay dependency-free). */

let honeypotDrops = 0;

/** Silently count a dropped bot submission (never surfaced publicly). */
export function noteNewsletterHoneypotDrop(): void {
  honeypotDrops += 1;
}

export function newsletterHoneypotDropCount(): number {
  return honeypotDrops;
}
