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
 * 2. RATE LIMIT — max 5 attempts per hour per (email + IP) pair.
 *    Fixed-window, in-memory. The IP is a PLACEHOLDER: the route passes
 *    the first x-forwarded-for hop (or "unknown") until a trusted-proxy
 *    setup exists. Production swap (Redis) keeps this class shape —
 *    see contact/policy.ts for the key design.
 */

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

export interface NewsletterRateLimitDecision {
  allowed: boolean;
  /** Attempts still allowed in the current window (0 when blocked). */
  remaining: number;
  /** Seconds to wait before retrying (0 when allowed). */
  retryAfterSeconds: number;
}

export class NewsletterRateLimiter {
  private readonly hits = new Map<string, { count: number; windowStart: number }>();

  constructor(
    private readonly maxAttempts: number = NEWSLETTER_RATE_LIMIT.maxAttempts,
    private readonly windowMs: number = NEWSLETTER_RATE_LIMIT.windowMs,
  ) {}

  check(key: string, now: Date = new Date()): NewsletterRateLimitDecision {
    const t = now.getTime();
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { count: 1, windowStart: t });
      return { allowed: true, remaining: this.maxAttempts - 1, retryAfterSeconds: 0 };
    }
    entry.count += 1;
    if (entry.count > this.maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.ceil((entry.windowStart + this.windowMs - t) / 1000),
      };
    }
    return { allowed: true, remaining: this.maxAttempts - entry.count, retryAfterSeconds: 0 };
  }

  /** Test/support helper — clears one key's window. */
  reset(key: string): void {
    this.hits.delete(key);
  }
}

/** Shared limiter for the public newsletter endpoint. */
export const newsletterRateLimiter = new NewsletterRateLimiter();

let honeypotDrops = 0;

/** Silently count a dropped bot submission (never surfaced publicly). */
export function noteNewsletterHoneypotDrop(): void {
  honeypotDrops += 1;
}

export function newsletterHoneypotDropCount(): number {
  return honeypotDrops;
}
