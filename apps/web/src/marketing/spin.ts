/**
 * Spin-the-wheel — ADV-18B (doc 22). Server-decided, honestly.
 *
 * Rules that are NOT negotiable (honesty convention):
 * - The outcome is picked SERVER-side with a CSPRNG
 *   (node:crypto randomInt) over the CONFIGURED weights. The client
 *   only animates to the segment the server returned.
 * - A no-prize segment must exist AND be reachable: the config
 *   schema refuses any segment list without at least one
 *   couponCode === null segment with weight > 0.
 * - Prize segments name an EXISTING Coupon code. At draw time a
 *   prize segment whose coupon is missing / inactive / deleted /
 *   outside its window is EXCLUDED from the draw (weights renormalise
 *   over the drawable set) and reported in the API meta — the odds
 *   shown in the widget are computed over the same drawable set, so
 *   what the customer sees is the real draw.
 * - A win awards a REAL claim through the coupon system: a new
 *   Coupon row (code SPIN-<spinId>) copying the prize template's
 *   type/value/limits, usageLimit 1 + perUserLimit 1, expiring after
 *   claimExpiryDays. The awarded Coupon row is the durable source of
 *   truth — checkout honours it exactly like any admin coupon.
 *
 * Spin RECORDS: there is no spin table (no migration in this slice).
 * Each spin writes (a) a TrackingEvent row (eventName "SpinWheel",
 * eventId = spinId — durable, aggregate-only) and (b) best-effort, a
 * Redis audit list entry (ephemeral, labelled as such in admin). The
 * daily limit counter is Redis-first with a process-memory fallback;
 * the backend that answered is reported in the API meta, never hidden.
 */
import { randomInt, randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import {
  readMarketingDoc,
  writeMarketingDoc,
  prismaMarketingDocStore,
  getMarketingRedis,
  type MarketingDocStore,
} from "./docs";
import { dhakaYmdOf, dhakaDayRangeUtc } from "@/lib/dhaka-date";

export const SPIN_CONFIG_KEY = "marketing.spin.config";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

export const spinSegmentSchema = z.object({
  id: z.string().min(1).max(40),
  labelBn: z.string().min(1).max(80),
  /** Existing Coupon code for a prize segment; null = no-prize. */
  couponCode: z.string().min(1).max(64).nullable(),
  weightBps: z.number().int().positive().max(10000),
});

export const spinConfigSchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    dailyLimit: z.number().int().min(1).max(10),
    claimExpiryDays: z.number().int().min(1).max(30),
    segments: z.array(spinSegmentSchema).min(2).max(12),
  })
  .superRefine((cfg, ctx) => {
    const ids = new Set(cfg.segments.map((s) => s.id));
    if (ids.size !== cfg.segments.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Segment ids must be unique." });
    }
    // The no-prize segment must exist and be reachable.
    if (!cfg.segments.some((s) => s.couponCode === null && s.weightBps > 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one no-prize segment (couponCode: null, weight > 0) is required.",
      });
    }
  });

export type SpinSegment = z.infer<typeof spinSegmentSchema>;
export type SpinConfig = z.infer<typeof spinConfigSchema>;

/** Code default used until staff save a config (doc row absent). The
 *  prize segment names the seed's real WELCOME10 coupon; if that
 *  coupon is ever deleted/deactivated the segment simply drops out
 *  of the draw (see header) — it never becomes a fake prize. */
export const DEFAULT_SPIN_CONFIG: SpinConfig = {
  version: 1,
  enabled: true,
  dailyLimit: 1,
  claimExpiryDays: 7,
  segments: [
    { id: "try-again", labelBn: "আবার চেষ্টা করুন", couponCode: null, weightBps: 6000 },
    { id: "surprise-coupon", labelBn: "সারপ্রাইজ কুপন", couponCode: "WELCOME10", weightBps: 2500 },
    { id: "no-luck", labelBn: "এবার হয়নি", couponCode: null, weightBps: 1500 },
  ],
};

export async function loadSpinConfig(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<SpinConfig> {
  return readMarketingDoc(store, SPIN_CONFIG_KEY, spinConfigSchema, DEFAULT_SPIN_CONFIG);
}

export async function saveSpinConfig(
  store: MarketingDocStore,
  config: SpinConfig,
  actorId: string,
): Promise<void> {
  await writeMarketingDoc(store, SPIN_CONFIG_KEY, config, actorId);
}

/* ------------------------------------------------------------------ */
/* Drawable segments + odds                                            */
/* ------------------------------------------------------------------ */

export interface DrawableSegment extends SpinSegment {
  /** Real probability of this segment in the next draw, percent. */
  oddsPercent: number;
}

export interface SpinDisplayConfig {
  enabled: boolean;
  dailyLimit: number;
  segments: DrawableSegment[];
  /** Prize segments dropped because their coupon is not drawable. */
  excludedPrizeSegments: Array<{ id: string; couponCode: string; reason: string }>;
}

interface CouponDrawableState {
  drawable: boolean;
  reason: string;
}

async function couponDrawableState(code: string, now: Date): Promise<CouponDrawableState> {
  const { prisma } = await import("@advance-ecommerce/db");
  const row = await prisma.coupon.findUnique({ where: { code } });
  if (row === null || row.deletedAt !== null) return { drawable: false, reason: "coupon not found" };
  if (!row.isActive) return { drawable: false, reason: "coupon inactive" };
  if (row.startsAt !== null && row.startsAt > now) return { drawable: false, reason: "coupon not started" };
  if (row.endsAt !== null && row.endsAt < now) return { drawable: false, reason: "coupon expired" };
  return { drawable: true, reason: "" };
}

/** The draw the customer actually faces: config segments minus
 *  prize segments whose coupon cannot pay out right now. */
export async function getSpinDisplayConfig(
  now: Date = new Date(),
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<SpinDisplayConfig> {
  const config = await loadSpinConfig(store);
  const drawable: SpinSegment[] = [];
  const excludedPrizeSegments: SpinDisplayConfig["excludedPrizeSegments"] = [];
  for (const segment of config.segments) {
    if (segment.couponCode === null) {
      drawable.push(segment);
      continue;
    }
    const state = await couponDrawableState(segment.couponCode, now);
    if (state.drawable) drawable.push(segment);
    else excludedPrizeSegments.push({ id: segment.id, couponCode: segment.couponCode, reason: state.reason });
  }
  const totalWeight = drawable.reduce((sum, s) => sum + s.weightBps, 0);
  return {
    enabled: config.enabled,
    dailyLimit: config.dailyLimit,
    segments: drawable.map((s) => ({
      ...s,
      oddsPercent: totalWeight > 0 ? Math.round((s.weightBps / totalWeight) * 10000) / 100 : 0,
    })),
    excludedPrizeSegments,
  };
}

/** Weighted pick with a CSPRNG. Exported for the smoke: over many
 *  draws the no-prize segments must be hit and shares must track the
 *  configured weights. */
export function pickSegment<T extends { weightBps: number }>(segments: readonly T[]): T {
  const total = segments.reduce((sum, s) => sum + s.weightBps, 0);
  if (total <= 0) throw new Error("pickSegment: no positive weights");
  let roll = randomInt(total);
  for (const segment of segments) {
    roll -= segment.weightBps;
    if (roll < 0) return segment;
  }
  return segments[segments.length - 1] as T;
}

/* ------------------------------------------------------------------ */
/* Daily limit counter (Redis-first, memory fallback — labelled)       */
/* ------------------------------------------------------------------ */

export type SpinCounterBackend = "redis" | "memory";

const memoryCounts = new Map<string, { count: number; day: string }>();

function secondsLeftInDhakaDay(now: Date): number {
  const { endUtc } = dhakaDayRangeUtc(dhakaYmdOf(now));
  return Math.max(60, Math.ceil((endUtc.getTime() - now.getTime()) / 1000));
}

async function readSpinCount(identityKey: string, now: Date): Promise<{ count: number; backend: SpinCounterBackend }> {
  const day = dhakaYmdOf(now);
  const key = `ae:spin:count:${identityKey}:${day}`;
  try {
    const redis = await getMarketingRedis();
    if (redis !== null) {
      const value = await redis.get(key);
      const n = value === null ? 0 : Number.parseInt(value, 10);
      return { count: Number.isFinite(n) ? n : 0, backend: "redis" };
    }
  } catch {
    // fall through to memory
  }
  const entry = memoryCounts.get(key);
  return { count: entry !== undefined && entry.day === day ? entry.count : 0, backend: "memory" };
}

async function bumpSpinCount(identityKey: string, now: Date): Promise<{ count: number; backend: SpinCounterBackend }> {
  const day = dhakaYmdOf(now);
  const key = `ae:spin:count:${identityKey}:${day}`;
  try {
    const redis = await getMarketingRedis();
    if (redis !== null) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, secondsLeftInDhakaDay(now) + 3600);
      return { count, backend: "redis" };
    }
  } catch {
    // fall through to memory
  }
  const entry = memoryCounts.get(key);
  const count = entry !== undefined && entry.day === day ? entry.count + 1 : 1;
  memoryCounts.set(key, { count, day });
  return { count, backend: "memory" };
}

/* ------------------------------------------------------------------ */
/* The spin                                                            */
/* ------------------------------------------------------------------ */

export type SpinIdentity =
  | { kind: "customer"; customerId: string }
  | { kind: "phone"; phone: string };

export interface SpinAward {
  couponCode: string;
  templateCode: string;
  expiresAt: string;
}

export type SpinResult =
  | {
      ok: true;
      spinId: string;
      outcome: "prize" | "none";
      segment: { id: string; labelBn: string; oddsPercent: number };
      award: SpinAward | null;
      spinsUsedToday: number;
      spinsLeftToday: number;
      counterBackend: SpinCounterBackend;
    }
  | { ok: false; code: "SPIN_DISABLED" | "LIMIT_REACHED" | "NO_DRAWABLE_SEGMENTS"; message: string; spinsLeftToday?: number; counterBackend?: SpinCounterBackend };

function identityKey(identity: SpinIdentity): string {
  return identity.kind === "customer" ? `cust:${identity.customerId}` : `phone:${identity.phone}`;
}

function identityAuditRef(identity: SpinIdentity): string {
  if (identity.kind === "customer") return `cust:${identity.customerId}`;
  // Phones never land in the audit log raw — a short hash is enough
  // for staff to spot repeat patterns.
  return `phone#${createHash("sha256").update(identity.phone).digest("hex").slice(0, 10)}`;
}

/** Create the winner's durable claim: a real Coupon row copied from
 *  the prize template, code SPIN-<spinId>. Idempotent per spinId. */
async function awardCouponClaim(templateCode: string, spinId: string, claimExpiryDays: number, now: Date): Promise<SpinAward> {
  const { prisma } = await import("@advance-ecommerce/db");
  const claimCode = `SPIN-${spinId.replace(/-/g, "").slice(0, 16).toUpperCase()}`;
  const existing = await prisma.coupon.findUnique({ where: { code: claimCode } });
  if (existing !== null) {
    return { couponCode: existing.code, templateCode, expiresAt: (existing.endsAt ?? now).toISOString() };
  }
  const template = await prisma.coupon.findUnique({ where: { code: templateCode } });
  if (template === null) throw new Error(`prize coupon vanished mid-spin: ${templateCode}`);
  const expiresAt = new Date(now.getTime() + claimExpiryDays * 24 * 3600 * 1000);
  const created = await prisma.coupon.create({
    data: {
      code: claimCode,
      type: template.type,
      valuePoisha: template.valuePoisha,
      valuePercent: template.valuePercent,
      minCartPoisha: template.minCartPoisha,
      maxDiscountPoisha: template.maxDiscountPoisha,
      usageLimit: 1,
      perUserLimit: 1,
      productIds: template.productIds,
      categoryIds: template.categoryIds,
      customerGroup: template.customerGroup,
      stackable: false,
      isActive: true,
      startsAt: now,
      endsAt: expiresAt,
    },
  });
  return { couponCode: created.code, templateCode, expiresAt: expiresAt.toISOString() };
}

export async function performSpin(
  identity: SpinIdentity,
  now: Date = new Date(),
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<SpinResult> {
  const config = await loadSpinConfig(store);
  if (!config.enabled) {
    return { ok: false, code: "SPIN_DISABLED", message: "স্পিন হুইল এখন বন্ধ আছে।" };
  }
  const key = identityKey(identity);
  const before = await readSpinCount(key, now);
  if (before.count >= config.dailyLimit) {
    return {
      ok: false,
      code: "LIMIT_REACHED",
      message: "আজকের স্পিন শেষ — আগামীকাল আবার চেষ্টা করুন।",
      spinsLeftToday: 0,
      counterBackend: before.backend,
    };
  }

  const display = await getSpinDisplayConfig(now, store);
  if (display.segments.length === 0) {
    return { ok: false, code: "NO_DRAWABLE_SEGMENTS", message: "এখন কোনো স্পিন উপলব্ধ নেই।" };
  }
  const picked = pickSegment(display.segments);
  const spinId = randomUUID();

  let award: SpinAward | null = null;
  if (picked.couponCode !== null) {
    award = await awardCouponClaim(picked.couponCode, spinId, config.claimExpiryDays, now);
  }
  const after = await bumpSpinCount(key, now);

  // Durable aggregate record (failure-isolated: a tracking-store
  // hiccup never eats a customer's awarded coupon).
  try {
    const { prisma } = await import("@advance-ecommerce/db");
    await prisma.trackingEvent.create({
      data: { eventId: spinId, eventName: "SpinWheel", orderId: null, occurredAt: now },
    });
  } catch {
    // duplicate / store unavailable — the claim row above is the truth.
  }
  // Ephemeral audit trail for staff (Redis list, capped).
  try {
    const redis = await getMarketingRedis();
    if (redis !== null) {
      await redis.lpush(
        "ae:spin:log",
        JSON.stringify({
          spinId,
          at: now.toISOString(),
          identity: identityAuditRef(identity),
          segmentId: picked.id,
          outcome: award !== null ? "prize" : "none",
          couponCode: award?.couponCode ?? null,
        }),
      );
      await redis.ltrim("ae:spin:log", 0, 499);
    }
  } catch {
    // audit trail is best-effort by design
  }

  return {
    ok: true,
    spinId,
    outcome: award !== null ? "prize" : "none",
    segment: { id: picked.id, labelBn: picked.labelBn, oddsPercent: picked.oddsPercent },
    award,
    spinsUsedToday: after.count,
    spinsLeftToday: Math.max(0, config.dailyLimit - after.count),
    counterBackend: after.backend,
  };
}

/** Recent spin audit entries (staff). Honest about the backend: the
 *  log is a Redis list — when Redis is absent there is no log, and
 *  this says so instead of inventing rows. */
export async function getRecentSpinLog(limit = 50): Promise<{ backend: "redis" | "unavailable"; entries: unknown[] }> {
  try {
    const redis = await getMarketingRedis();
    if (redis === null) return { backend: "unavailable", entries: [] };
    const raw = await redis.lrange("ae:spin:log", 0, Math.max(0, limit - 1));
    const entries: unknown[] = [];
    for (const item of raw) {
      try {
        entries.push(JSON.parse(item));
      } catch {
        // skip malformed entries
      }
    }
    return { backend: "redis", entries };
  } catch {
    return { backend: "unavailable", entries: [] };
  }
}
