/**
 * Server-only rate check for the public review endpoint: 5 attempts /
 * hour / (phone + IP), counted in the shared Redis-backed limiter
 * (src/lib/rate-limit.ts) under a `review-submit:` key prefix — the
 * raw key stays phone|ip, exactly as reviewRateLimitKey in ./policy
 * builds it. Falls back to a process-local window inside
 * checkRateLimit when Redis is unavailable — never throws.
 *
 * Kept OUT of ./policy on purpose: client code imports policy
 * constants, and this module loads ioredis (Node builtins), which
 * must never enter the client bundle.
 */
import { checkRateLimit, type RateLimitDecision } from "@/lib/rate-limit";
import { REVIEW_RATE_LIMIT } from "./policy";

export async function checkReviewRateLimit(key: string): Promise<RateLimitDecision> {
  return checkRateLimit(`review-submit:${key}`, REVIEW_RATE_LIMIT.maxAttempts, REVIEW_RATE_LIMIT.windowMs);
}
