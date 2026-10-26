/**
 * Server-only rate check for the public newsletter endpoint: 5
 * attempts / hour / (email + IP), counted in the shared Redis-backed
 * limiter (src/lib/rate-limit.ts) under a `newsletter:` key prefix —
 * the raw key stays email|ip, exactly as newsletterRateLimitKey in
 * ./policy builds it. Falls back to a process-local window inside
 * checkRateLimit when Redis is unavailable — never throws.
 *
 * Kept OUT of ./policy on purpose: the client NewsletterForm imports
 * policy constants, and this module loads ioredis (Node builtins),
 * which must never enter the client bundle.
 */
import { checkRateLimit, type RateLimitDecision } from "@/lib/rate-limit";
import { NEWSLETTER_RATE_LIMIT } from "./policy";

export async function checkNewsletterRateLimit(key: string): Promise<RateLimitDecision> {
  return checkRateLimit(`newsletter:${key}`, NEWSLETTER_RATE_LIMIT.maxAttempts, NEWSLETTER_RATE_LIMIT.windowMs);
}
