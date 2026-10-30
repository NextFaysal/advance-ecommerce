/**
 * Marketing mechanics (ADV-18B, doc 22) — shared persistence seams.
 *
 * Config/campaign documents live as JSON docs in Setting rows, the
 * established saved-reports pattern (src/reports/saved-reports.ts):
 * the generic settings API rejects unknown keys, and these documents
 * are machine-shaped, so they get their own zod-validated doc store
 * over prisma.setting. Keys:
 *   marketing.spin.config  -> spin-wheel configuration (spin.ts)
 *   marketing.experiments  -> A/B experiment definitions (experiments.ts)
 *   marketing.broadcasts   -> WhatsApp broadcast campaigns (broadcast.ts)
 *
 * The whole pack is gated by the feature flag
 * `module.marketing_mechanics` (seeded OFF in seed.ts FEATURE_FLAGS,
 * mirrored in src/lib/feature-flags.ts).
 */
import type { z } from "zod";
import { isFeatureEnabled } from "@/lib/feature-flags";

export const MARKETING_MECHANICS_FLAG = "module.marketing_mechanics";

export function marketingMechanicsEnabled(): boolean {
  return isFeatureEnabled(MARKETING_MECHANICS_FLAG);
}

/* ------------------------------------------------------------------ */
/* JSON document store over the Setting table                          */
/* ------------------------------------------------------------------ */

export interface MarketingDocStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store (prisma imported lazily, the saved-reports /
 *  return-notify pattern, so pure-logic consumers never drag the DB
 *  client in). */
export function prismaMarketingDocStore(): MarketingDocStore {
  return {
    async read(key) {
      try {
        const { prisma } = await import("@advance-ecommerce/db");
        const row = await prisma.setting.findUnique({ where: { key } });
        return row?.value ?? null;
      } catch {
        return null;
      }
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Marketing mechanics document (JSON, ADV-18B)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

/** Read + zod-validate a JSON doc; any problem (missing, unparsable,
 *  schema drift) degrades to `empty` — never throws into a page. */
export async function readMarketingDoc<T>(
  store: MarketingDocStore,
  key: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  empty: T,
): Promise<T> {
  const raw = await store.read(key);
  if (raw === null || raw.trim() === "") return empty;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : empty;
  } catch {
    return empty;
  }
}

export async function writeMarketingDoc(
  store: MarketingDocStore,
  key: string,
  doc: unknown,
  actorId: string,
): Promise<void> {
  await store.write(key, JSON.stringify(doc), actorId);
}

/* ------------------------------------------------------------------ */
/* Lazy Redis (spin counters + the ephemeral spin audit log)           */
/* ------------------------------------------------------------------ */

/** The slice of ioredis the spin module uses. */
export interface MarketingRedis {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  pttl(key: string): Promise<number>;
  lpush(key: string, value: string): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

interface RedisConstructorLike {
  new (url: string, options?: Record<string, unknown>): MarketingRedis;
}

interface IoRedisShape {
  default?: RedisConstructorLike;
  Redis?: RedisConstructorLike;
}

let redisPromise: Promise<MarketingRedis | null> | null = null;

/**
 * Shared lazy Redis client, mirroring src/lib/rate-limit.ts: literal
 * dynamic import (Next's server bundler cannot resolve variable
 * specifiers; ioredis is in serverExternalPackages), null when
 * REDIS_URL is unset. Callers MUST handle null — Redis here is an
 * accelerator/audit trail, never the source of truth.
 */
export function getMarketingRedis(): Promise<MarketingRedis | null> {
  if (redisPromise === null) {
    redisPromise = (async () => {
      const url = process.env.REDIS_URL;
      if (url === undefined || url === "") return null;
      const ioredis = (await import("ioredis")) as unknown as IoRedisShape;
      const Ctor = ioredis.default ?? ioredis.Redis;
      if (typeof Ctor !== "function") return null;
      const client = new Ctor(url, { maxRetriesPerRequest: 2 });
      client.on("error", () => {});
      return client;
    })();
    redisPromise.catch(() => {
      redisPromise = null;
    });
  }
  return redisPromise;
}
