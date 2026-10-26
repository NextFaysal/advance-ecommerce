/**
 * Redis Client & Helpers — Central connection, pub/sub, cache, and rate-limiting.
 *
 * Implements the Redis integration specified in BACKLOG:
 * - Connection: uses `ioredis` when REDIS_URL is configured in server env
 * - Fallback: graceful in-memory fallback when REDIS_URL is absent or unreachable
 * - Rate-limiting: sliding/fixed window counter with automatic TTL
 * - Pub/Sub: channel messaging for order SSE feed and rider assignment board
 * - Settings Cache: distributed key-value cache with TTL
 */
import Redis from "ioredis";

let redisClient: Redis | null = null;
let redisPubClient: Redis | null = null;
let redisSubClient: Redis | null = null;
let redisAvailable = false;

// In-memory fallback map for when Redis is unconfigured
const memoryCache = new Map<string, { value: string; expiresAt: number }>();
const memoryRateLimits = new Map<string, { count: number; resetAt: number }>();

function createClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  try {
    const client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null; // Stop reconnecting after 3 attempts in local dev
        return Math.min(times * 200, 1000);
      },
    });

    client.on("connect", () => {
      redisAvailable = true;
    });

    client.on("error", () => {
      redisAvailable = false;
    });

    client.connect().catch(() => {
      redisAvailable = false;
    });

    return client;
  } catch {
    return null;
  }
}

export function getRedisClient(): Redis | null {
  if (!redisClient && process.env.REDIS_URL) {
    redisClient = createClient();
  }
  return redisAvailable ? redisClient : null;
}

/** Settings & data caching with Redis + Memory fallback */
export async function getCachedValue(key: string): Promise<string | null> {
  const client = getRedisClient();
  if (client) {
    try {
      return await client.get(`cache:${key}`);
    } catch {
      // Fallback
    }
  }

  // Memory fallback
  const entry = memoryCache.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.value;
  }
  memoryCache.delete(key);
  return null;
}

export async function setCachedValue(key: string, value: string, ttlSeconds = 300): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.set(`cache:${key}`, value, "EX", ttlSeconds);
      return;
    } catch {
      // Fallback
    }
  }

  // Memory fallback
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function invalidateCacheKey(key?: string): Promise<void> {
  const client = getRedisClient();
  if (key) {
    if (client) {
      try {
        await client.del(`cache:${key}`);
      } catch {
        // Fallback
      }
    }
    memoryCache.delete(key);
  } else {
    memoryCache.clear();
  }
}

/** Rate limiter with Redis INCR + Memory fallback */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export async function checkRateLimit(
  key: string,
  maxAttempts = 5,
  windowSeconds = 900,
): Promise<RateLimitDecision> {
  const client = getRedisClient();
  const redisKey = `ratelimit:${key}`;

  if (client) {
    try {
      const current = await client.incr(redisKey);
      if (current === 1) {
        await client.expire(redisKey, windowSeconds);
      }
      const ttl = await client.ttl(redisKey);
      const resetSeconds = ttl > 0 ? ttl : windowSeconds;

      return {
        allowed: current <= maxAttempts,
        remaining: Math.max(0, maxAttempts - current),
        resetSeconds,
      };
    } catch {
      // Fallback to memory
    }
  }

  // Memory fallback
  const now = Date.now();
  const entry = memoryRateLimits.get(key);

  if (!entry || entry.resetAt <= now) {
    memoryRateLimits.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return {
      allowed: true,
      remaining: maxAttempts - 1,
      resetSeconds: windowSeconds,
    };
  }

  entry.count += 1;
  const remaining = Math.max(0, maxAttempts - entry.count);
  const resetSeconds = Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed: entry.count <= maxAttempts,
    remaining,
    resetSeconds,
  };
}

export async function resetRateLimit(key: string): Promise<void> {
  const client = getRedisClient();
  if (client) {
    try {
      await client.del(`ratelimit:${key}`);
    } catch {
      // Fallback
    }
  }
  memoryRateLimits.delete(key);
}

/** Redis Pub/Sub for SSE live order feed and real-time boards */
export async function redisPublish(channel: string, message: unknown): Promise<void> {
  if (!process.env.REDIS_URL) return;
  if (!redisPubClient) {
    redisPubClient = createClient();
  }
  if (redisPubClient) {
    try {
      await redisPubClient.publish(channel, JSON.stringify(message));
    } catch {
      // Swallowed
    }
  }
}

export async function redisSubscribe(
  channel: string,
  onMessage: (message: string) => void,
): Promise<() => void> {
  if (!process.env.REDIS_URL) return () => {};
  if (!redisSubClient) {
    redisSubClient = createClient();
  }
  if (!redisSubClient) return () => {};

  try {
    await redisSubClient.subscribe(channel);
    const handler = (ch: string, msg: string) => {
      if (ch === channel) {
        onMessage(msg);
      }
    };
    redisSubClient.on("message", handler);

    return () => {
      redisSubClient?.unsubscribe(channel).catch(() => {});
      redisSubClient?.off("message", handler);
    };
  } catch {
    return () => {};
  }
}
