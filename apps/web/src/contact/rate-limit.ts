/**
 * Server-only rate check for the public contact endpoint: 3
 * submissions / hour / (phone + IP), counted in the shared
 * Redis-backed limiter (src/lib/rate-limit.ts) under a
 * `contact-submit:` key prefix — the raw key stays phone|ip, exactly
 * as contactRateLimitKey in ./policy builds it. Falls back to a
 * process-local window inside checkRateLimit when Redis is
 * unavailable — never throws.
 *
 * Kept OUT of ./policy on purpose: client code imports policy
 * constants, and this module loads ioredis (Node builtins), which
 * must never enter the client bundle.
 */
import { checkRateLimit, type RateLimitDecision } from "@/lib/rate-limit";
import { CONTACT_RATE_LIMIT } from "./policy";

export async function checkContactRateLimit(key: string): Promise<RateLimitDecision> {
  return checkRateLimit(
    `contact-submit:${key}`,
    CONTACT_RATE_LIMIT.maxSubmissions,
    CONTACT_RATE_LIMIT.windowMs,
  );
}
