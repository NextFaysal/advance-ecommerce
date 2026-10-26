/**
 * Shared rate limiter — Redis-backed fixed window (doc 21 G3-20).
 *
 * Until now every public route carried its own in-memory limiter
 * (tracking, contact, newsletter, reviews each had a copy). This is
 * the shared one: counts live in Redis under REDIS_URL, so limits hold
 * across server instances (production runs on Upstash — the same
 * Redis the queues use).
 *
 * Contract mirrors the old in-memory limiters' check():
 *   { allowed, retryAfterSeconds }
 * plus `backend`, so callers can report honestly which store answered.
 *
 * Degradation is deliberate and never throws: when REDIS_URL is unset
 * or Redis errors, the check falls back to a process-local fixed
 * window (weaker — per-instance — but the endpoint keeps SOME
 * protection and never hard-fails a customer request over a limiter
 * outage). ioredis loads via a LITERAL dynamic import, the same
 * pattern as the queue producers in src/orders/otp.ts (Next.js's
 * server bundler cannot resolve variable specifiers; ioredis is in
 * next.config serverExternalPackages).
 */

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
  backend: "redis" | "memory";
}

interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<number>;
  pttl(key: string): Promise<number>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface RedisConstructorLike {
  new (url: string, options?: Record<string, unknown>): RedisLike;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

async function loadIoRedis(): Promise<IoRedisShape> {
  return (await import("ioredis")) as unknown as IoRedisShape;
}

let redisPromise: Promise<RedisLike | null> | null = null;

function getRedis(): Promise<RedisLike | null> {
  if (redisPromise === null) {
    redisPromise = (async () => {
      const url = process.env.REDIS_URL;
      if (url === undefined || url === "") return null;
      const ioredis = await loadIoRedis();
      const Ctor = ioredis.default ?? ioredis.Redis;
      if (typeof Ctor !== "function") return null;
      const client = new Ctor(url, { maxRetriesPerRequest: 2 });
      // Without an error listener an unreachable Redis crashes the
      // process via EventEmitter; failures surface through the awaited
      // commands instead, which checkRateLimit turns into the fallback.
      client.on("error", () => {});
      return client;
    })();
    // A failed construction must not poison the process — the next
    // check retries (e.g. after REDIS_URL appears).
    redisPromise.catch(() => {
      redisPromise = null;
    });
  }
  return redisPromise;
}

/* Process-local fallback: the same fixed-window maths the per-route
 * in-memory limiters always used, kept only for Redis outages. */
const memoryHits = new Map<string, { count: number; windowStart: number }>();

function checkMemory(key: string, max: number, windowMs: number): RateLimitDecision {
  const t = Date.now();
  const entry = memoryHits.get(key);
  if (!entry || t - entry.windowStart >= windowMs) {
    memoryHits.set(key, { count: 1, windowStart: t });
    return { allowed: true, retryAfterSeconds: 0, backend: "memory" };
  }
  entry.count += 1;
  if (entry.count > max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.windowStart + windowMs - t) / 1000)),
      backend: "memory",
    };
  }
  return { allowed: true, retryAfterSeconds: 0, backend: "memory" };
}

/**
 * Fixed-window check: at most `max` hits per `windowMs` for `key`.
 * The window starts at the first hit (INCR creates the key, PEXPIRE
 * arms its expiry); retryAfterSeconds comes from the key's real TTL.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const redis = await getRedis().catch(() => null);
  if (redis === null) return checkMemory(key, max, windowMs);
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.pexpire(key, windowMs);
    if (count > max) {
      const ttl = await redis.pttl(key);
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((ttl > 0 ? ttl : windowMs) / 1000)),
        backend: "redis",
      };
    }
    return { allowed: true, retryAfterSeconds: 0, backend: "redis" };
  } catch {
    // Redis died mid-check: drop the cached client so the next call
    // retries, and answer from the local window this once.
    redisPromise = null;
    return checkMemory(key, max, windowMs);
  }
}
