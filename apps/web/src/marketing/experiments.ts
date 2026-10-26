/**
 * A/B testing — ADV-18B (doc 22). v1 target: the homepage hero.
 *
 * Definitions live in the Setting doc `marketing.experiments`
 * (see docs.ts). Assignment is a deterministic hash of the visitor
 * id (the `ae_vid` cookie): the same visitor always lands in the
 * same variant, with no server-side assignment table.
 *
 * Counting rides the TrackingEvent table (the durable write path
 * the ADV-8 funnel uses). The public track-events intake restricts
 * eventName to the standard CAPI enum, so experiment events are
 * written server-side into the same append-only table with the
 * encoding:
 *   eventName = "AB:<expId>:<variantKey>:exposure"   (eventId is a
 *               deterministic hash of expId+visitorId — one exposure
 *               per unique visitor per experiment, replays dedupe
 *               on the unique eventId)
 *   eventName = "AB:<expId>:<variantKey>:conversion" (eventId is a
 *               deterministic hash of expId+orderId — one conversion
 *               per real order per experiment; the order row is
 *               verified to exist before anything is written)
 * Stats are RAW COUNTS + a descriptive conversion percentage only.
 * No significance, no "winner" claims — the admin UI labels them
 * exactly that way.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  readMarketingDoc,
  writeMarketingDoc,
  prismaMarketingDocStore,
  type MarketingDocStore,
} from "./docs";

export const EXPERIMENTS_KEY = "marketing.experiments";
export const VISITOR_COOKIE = "ae_vid";

export const heroCopySchema = z.object({
  headlineBn: z.string().min(1).max(160),
  subBn: z.string().max(300).default(""),
  ctaLabelBn: z.string().min(1).max(60),
  ctaHref: z.string().min(1).max(200),
});

export const experimentVariantSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  weightBps: z.number().int().min(0).max(10000),
  /** Absent = control: the visitor sees the current hero as-is. */
  hero: heroCopySchema.optional(),
});

export const experimentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(120),
  status: z.enum(["draft", "running", "stopped"]),
  target: z.literal("hero"),
  createdAt: z.string(),
  variants: z.array(experimentVariantSchema).min(2).max(4),
});

export const experimentsDocSchema = z.object({
  version: z.literal(1),
  experiments: z.array(experimentSchema).max(20),
});

export type HeroCopy = z.infer<typeof heroCopySchema>;
export type ExperimentVariant = z.infer<typeof experimentVariantSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentsDoc = z.infer<typeof experimentsDocSchema>;

export const EMPTY_EXPERIMENTS_DOC: ExperimentsDoc = { version: 1, experiments: [] };

export async function loadExperimentsDoc(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<ExperimentsDoc> {
  return readMarketingDoc(store, EXPERIMENTS_KEY, experimentsDocSchema, EMPTY_EXPERIMENTS_DOC);
}

export async function saveExperimentsDoc(
  store: MarketingDocStore,
  doc: ExperimentsDoc,
  actorId: string,
): Promise<void> {
  await writeMarketingDoc(store, EXPERIMENTS_KEY, doc, actorId);
}

/** Deterministic assignment: sha256("<expId>:<visitorId>") bucketed
 *  over the variant weights (weights need not sum to 10000 — the
 *  bucket space is the weight total). Pure; exported for the smoke
 *  (same visitor -> same variant, always). */
export function assignVariant(experiment: Experiment, visitorId: string): ExperimentVariant | null {
  const total = experiment.variants.reduce((sum, v) => sum + v.weightBps, 0);
  if (total <= 0) return null;
  const digest = createHash("sha256").update(`${experiment.id}:${visitorId}`).digest();
  const bucket = digest.readUInt32BE(0) % total;
  let cursor = 0;
  for (const variant of experiment.variants) {
    cursor += variant.weightBps;
    if (bucket < cursor) return variant;
  }
  return experiment.variants[experiment.variants.length - 1] ?? null;
}

export async function getRunningHeroExperiment(
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<Experiment | null> {
  const doc = await loadExperimentsDoc(store);
  return doc.experiments.find((e) => e.status === "running" && e.target === "hero") ?? null;
}

function exposureEventId(expId: string, visitorId: string): string {
  return `abexp-${createHash("sha256").update(`${expId}:${visitorId}`).digest("hex").slice(0, 32)}`;
}

function conversionEventId(expId: string, orderId: string): string {
  return `abconv-${createHash("sha256").update(`${expId}:${orderId}`).digest("hex").slice(0, 32)}`;
}

/** Record one exposure (deduped by the unique eventId — a returning
 *  visitor never inflates the count). Failure-isolated. */
export async function recordExposure(expId: string, variantKey: string, visitorId: string, now: Date = new Date()): Promise<void> {
  try {
    const { prisma } = await import("@advance-ecommerce/db");
    await prisma.trackingEvent.create({
      data: {
        eventId: exposureEventId(expId, visitorId),
        eventName: `AB:${expId}:${variantKey}:exposure`,
        orderId: null,
        occurredAt: now,
      },
    });
  } catch {
    // already recorded (unique eventId) or store down — never throw
  }
}

export interface HeroResolution {
  experiment: Experiment;
  variant: ExperimentVariant;
  /** The variant's hero copy; null for the control variant. */
  hero: HeroCopy | null;
}

/** Homepage seam: resolve the running hero experiment for a visitor
 *  and record their (deduped) exposure. Returns null when no
 *  experiment runs, the visitor has no id yet, or the assigned
 *  variant carries no copy AND is the control — callers still get a
 *  resolution for the control so exposure counting stays honest;
 *  `hero === null` means "render the current hero". */
export async function resolveHeroForVisitor(
  visitorId: string | null,
  store: MarketingDocStore = prismaMarketingDocStore(),
  now: Date = new Date(),
): Promise<HeroResolution | null> {
  if (visitorId === null || visitorId === "") return null;
  const experiment = await getRunningHeroExperiment(store);
  if (experiment === null) return null;
  const variant = assignVariant(experiment, visitorId);
  if (variant === null) return null;
  await recordExposure(experiment.id, variant.key, visitorId, now);
  return { experiment, variant, hero: variant.hero ?? null };
}

/** Record conversions for a REAL order: the order must exist, then
 *  every running hero experiment the visitor is assigned to gets one
 *  conversion row for its variant. Returns the experiments recorded
 *  (empty when the visitor is unknown or the order doesn't exist). */
export async function recordConversionForOrder(
  visitorId: string | null,
  orderId: string,
  store: MarketingDocStore = prismaMarketingDocStore(),
  now: Date = new Date(),
): Promise<Array<{ expId: string; variantKey: string }>> {
  if (visitorId === null || visitorId === "" || orderId === "") return [];
  const { prisma } = await import("@advance-ecommerce/db");
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (order === null) return [];
  const doc = await loadExperimentsDoc(store);
  const recorded: Array<{ expId: string; variantKey: string }> = [];
  for (const experiment of doc.experiments) {
    if (experiment.status !== "running" || experiment.target !== "hero") continue;
    const variant = assignVariant(experiment, visitorId);
    if (variant === null) continue;
    try {
      await prisma.trackingEvent.create({
        data: {
          eventId: conversionEventId(experiment.id, orderId),
          eventName: `AB:${experiment.id}:${variant.key}:conversion`,
          orderId,
          occurredAt: now,
        },
      });
      recorded.push({ expId: experiment.id, variantKey: variant.key });
    } catch {
      // already recorded for this order — one conversion per order
    }
  }
  return recorded;
}

/* ------------------------------------------------------------------ */
/* Stats — raw counts only                                             */
/* ------------------------------------------------------------------ */

export interface VariantStats {
  variantKey: string;
  /** Unique visitors exposed (deduped eventIds). */
  exposures: number;
  /** Real orders attributed (one per order per experiment). */
  conversions: number;
  /** Descriptive only — NOT a significance statement. */
  conversionPercent: number | null;
}

export interface ExperimentStats {
  expId: string;
  variants: VariantStats[];
  note: "raw_counts_only";
}

export async function getExperimentStats(expId: string): Promise<ExperimentStats> {
  const { prisma } = await import("@advance-ecommerce/db");
  const rows = await prisma.trackingEvent.findMany({
    where: { eventName: { startsWith: `AB:${expId}:` } },
    select: { eventName: true },
  });
  const byVariant = new Map<string, { exposures: number; conversions: number }>();
  for (const row of rows) {
    const parts = row.eventName.split(":");
    if (parts.length !== 4) continue;
    const variantKey = parts[2] as string;
    const kind = parts[3];
    const entry = byVariant.get(variantKey) ?? { exposures: 0, conversions: 0 };
    if (kind === "exposure") entry.exposures += 1;
    else if (kind === "conversion") entry.conversions += 1;
    byVariant.set(variantKey, entry);
  }
  return {
    expId,
    variants: [...byVariant.entries()].map(([variantKey, v]) => ({
      variantKey,
      exposures: v.exposures,
      conversions: v.conversions,
      conversionPercent: v.exposures > 0 ? Math.round((v.conversions / v.exposures) * 10000) / 100 : null,
    })),
    note: "raw_counts_only",
  };
}
