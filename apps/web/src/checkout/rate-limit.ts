/**
 * Server-only rate check for the public abandoned-checkout capture
 * endpoint: 30 captures / 10 minutes / (phone + IP), counted in the
 * shared Redis-backed limiter (src/lib/rate-limit.ts) under an
 * `abandoned-capture:` key prefix — the raw key stays phone|ip,
 * exactly as abandonedCaptureRateKey in ./abandoned builds it.
 * Falls back to a process-local window inside checkRateLimit when
 * Redis is unavailable — never throws.
 *
 * Capture is debounced client-side, so a real shopper produces a
 * handful of calls; 30 per 10 minutes is generous headroom while
 * still stopping scripted cart-spam. Same values the old in-memory
 * ContactRateLimiter instance enforced (wave 54 migration); the
 * shared limiter also counts every call, exactly as the old class's
 * check() did, so the attempt semantics are unchanged — only the
 * store moved (in-process Map → Redis, i.e. the limit now holds
 * across instances).
 */
import { checkRateLimit, type RateLimitDecision } from "@/lib/rate-limit";

export const ABANDONED_CAPTURE_RATE_LIMIT = {
  maxCaptures: 30,
  windowMs: 10 * 60 * 1000, // 10 minutes
} as const;

export async function checkAbandonedCaptureRateLimit(key: string): Promise<RateLimitDecision> {
  return checkRateLimit(
    `abandoned-capture:${key}`,
    ABANDONED_CAPTURE_RATE_LIMIT.maxCaptures,
    ABANDONED_CAPTURE_RATE_LIMIT.windowMs,
  );
}
