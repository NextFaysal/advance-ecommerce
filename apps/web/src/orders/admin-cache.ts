/**
 * Read-through cache for the admin ORDERS aggregate endpoints
 * (2026-10-29 orders speed wave).
 *
 * The KPI pack, POS-sales summary, aging board and stale-unpaid
 * list are recomputed from the orders tables on every page view;
 * on a cold Neon connection each computation stacks several
 * sequential query rounds and the four panels together dominated
 * the orders page's 14 s production load. Their results are now
 * cached for 60 s through the shared Redis helpers (src/lib/redis —
 * the same getCachedValue/setCachedValue pattern as the admin
 * dashboard and analytics, including the in-memory fallback when
 * Redis is absent).
 *
 * Rules, mirroring the dashboard wave:
 *  - the COMPUTED RESULT is cached verbatim — the math never
 *    changes; a hit returns exactly what a fresh computation
 *    returned at write time, so figures can lag reality by at
 *    most the TTL (60 s, chosen because orders ops are
 *    time-sensitive);
 *  - a computation that throws is never cached (the throw
 *    propagates to the route exactly as before);
 *  - a cache entry that fails the caller's shape check is ignored
 *    and recomputed;
 *  - cache read/write failures never break the request.
 *
 * The orders LIST endpoint deliberately does NOT use this helper:
 * staff work the live list (status changes, new orders), so it
 * stays uncached and was optimised at the query level instead.
 */
import { getCachedValue, setCachedValue } from "@/lib/redis";

export const ORDERS_AGGREGATE_CACHE_TTL_SECONDS = 60;

export async function readThroughOrdersCache<T>(
  cacheKey: string,
  isValid: (parsed: unknown) => parsed is T,
  compute: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await getCachedValue(cacheKey);
    if (cached !== null) {
      const parsed: unknown = JSON.parse(cached);
      if (isValid(parsed)) return parsed;
    }
  } catch {
    // An unreadable/corrupt cache entry must never break the
    // endpoint — fall through to the live computation.
  }
  const data = await compute();
  try {
    await setCachedValue(cacheKey, JSON.stringify(data), ORDERS_AGGREGATE_CACHE_TTL_SECONDS);
  } catch {
    // Cache writes are best-effort (the helpers already swallow
    // Redis errors; this only guards the serialization step).
  }
  return data;
}
