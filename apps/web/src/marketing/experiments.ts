/**
 * A/B testing — ADV-18B (doc 22). v1 target: the homepage hero.
 * Doc 34 §3.8/L9 grows the target to funnel steps (CartFlows-style
 * step testing): an experiment may instead target
 * `{ kind: "funnel_step", funnelId, stepId }`, whose variants carry
 * an alternate landing `pageId`. The hero machinery below is
 * unchanged: assignment hashing, the AB: event encoding and both
 * deterministic eventId functions are byte-identical to v1, so
 * every running hero experiment keeps its exact assignments and
 * dedupe behaviour. Funnel-step experiments reuse the same
 * assignment + encoding, namespaced by their own experiment ids
 * (ids are unique across the doc, so the namespaces never collide).
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
  /** Funnel-step variants only (doc 34 §3.8): the alternate landing
   *  page this variant serves for the targeted step. Absent =
   *  control: the visitor sees the step's own page. Optional and
   *  additive — hero variants never carry it, and stored v1
   *  variants parse identically without it. */
  pageId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
});

/** Doc 34 §3.8: a funnel-step target. funnelId/stepId are the
 *  funnel's slug/id + step key from the Funnel steps envelope —
 *  charset covers slugs and cuids, never a ":". */
export const funnelStepTargetSchema = z.object({
  kind: z.literal("funnel_step"),
  funnelId: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  stepId: z.string().regex(/^[A-Za-z0-9_-]{1,60}$/),
});

/** "hero" stays the bare literal it has always been stored as, so
 *  every saved v1 doc parses unchanged. */
export const experimentTargetSchema = z.union([z.literal("hero"), funnelStepTargetSchema]);

export const experimentSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: z.string().min(1).max(120),
  status: z.enum(["draft", "running", "stopped"]),
  target: experimentTargetSchema,
  createdAt: z.string(),
  variants: z.array(experimentVariantSchema).min(2).max(4),
});

export const experimentsDocSchema = z.object({
  version: z.literal(1),
  experiments: z.array(experimentSchema).max(20),
});

export type HeroCopy = z.infer<typeof heroCopySchema>;
export type ExperimentVariant = z.infer<typeof experimentVariantSchema>;
export type FunnelStepTarget = z.infer<typeof funnelStepTargetSchema>;
export type ExperimentTarget = z.infer<typeof experimentTargetSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export type ExperimentsDoc = z.infer<typeof experimentsDocSchema>;

export function isFunnelStepTarget(target: ExperimentTarget): target is FunnelStepTarget {
  return typeof target === "object" && target.kind === "funnel_step";
}

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
 *  (same visitor -> same variant, always). Target-agnostic: it
 *  reads only the experiment id + variant weights, so funnel-step
 *  experiments (§3.8) reuse it verbatim and hero assignments are
 *  bit-for-bit what they were before the target union existed. */
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
/* Funnel-step experiments (doc 34 §3.8)                               */
/* ------------------------------------------------------------------ */

export async function getRunningFunnelStepExperiment(
  funnelId: string,
  stepId: string,
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<Experiment | null> {
  const doc = await loadExperimentsDoc(store);
  return (
    doc.experiments.find(
      (e) =>
        e.status === "running" &&
        isFunnelStepTarget(e.target) &&
        e.target.funnelId === funnelId &&
        e.target.stepId === stepId,
    ) ?? null
  );
}

/** Every running experiment targeting ANY step of this funnel —
 *  the conversion seam iterates these when a funnel order lands. */
export async function getRunningFunnelExperiments(
  funnelId: string,
  store: MarketingDocStore = prismaMarketingDocStore(),
): Promise<Experiment[]> {
  const doc = await loadExperimentsDoc(store);
  return doc.experiments.filter(
    (e) => e.status === "running" && isFunnelStepTarget(e.target) && e.target.funnelId === funnelId,
  );
}

export interface FunnelStepResolution {
  experiment: Experiment;
  variant: ExperimentVariant;
  /** The variant's alternate page for the step; null for the
   *  control variant — "render the step's own page". */
  pageId: string | null;
}

/** Funnel seam (mirrors resolveHeroForVisitor): resolve the running
 *  experiment for one funnel step for a visitor and record their
 *  (deduped) exposure in the same AB: encoding. Returns null when
 *  no experiment runs on that step or the visitor has no id yet. */
export async function resolveFunnelStepForVisitor(
  funnelId: string,
  stepId: string,
  visitorId: string | null,
  store: MarketingDocStore = prismaMarketingDocStore(),
  now: Date = new Date(),
): Promise<FunnelStepResolution | null> {
  if (visitorId === null || visitorId === "") return null;
  const experiment = await getRunningFunnelStepExperiment(funnelId, stepId, store);
  if (experiment === null) return null;
  const variant = assignVariant(experiment, visitorId);
  if (variant === null) return null;
  await recordExposure(experiment.id, variant.key, visitorId, now);
  return { experiment, variant, pageId: variant.pageId ?? null };
}

/** Record conversions for a REAL funnel order (mirrors
 *  recordConversionForOrder): the order must exist, then every
 *  running experiment on this funnel gets one conversion row for
 *  the visitor's assigned variant — same AB: encoding, same
 *  deterministic eventId, so a replayed call dedupes. Returns the
 *  experiments recorded. */
export async function recordFunnelConversionForOrder(
  visitorId: string | null,
  orderId: string,
  funnelId: string,
  store: MarketingDocStore = prismaMarketingDocStore(),
  now: Date = new Date(),
): Promise<Array<{ expId: string; variantKey: string }>> {
  if (visitorId === null || visitorId === "" || orderId === "" || funnelId === "") return [];
  const { prisma } = await import("@advance-ecommerce/db");
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (order === null) return [];
  const experiments = await getRunningFunnelExperiments(funnelId, store);
  const recorded: Array<{ expId: string; variantKey: string }> = [];
  for (const experiment of experiments) {
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

export interface VariantRevenueStats extends VariantStats {
  /** Sum of the attributed orders' totalPoisha for this variant —
   *  revenue read from the order rows, never re-derived. */
  revenuePoisha: number;
  /** revenuePoisha / exposures, rounded to whole poisha.
   *  Descriptive only — NOT a significance statement. */
  revenuePerVisitorPoisha: number | null;
}

export interface ExperimentRevenueStats {
  expId: string;
  variants: VariantRevenueStats[];
  note: "raw_counts_only";
}

/** getExperimentStats + revenue (doc 34 §3.8: the funnel A/B winner
 *  metric shown is conversion rate AND revenue per visitor — both
 *  raw descriptive numbers). Conversion events carry their orderId;
 *  revenue joins those ids to the orders' totals. Additive: the
 *  counts above are computed by the original function, untouched. */
export async function getExperimentStatsWithRevenue(expId: string): Promise<ExperimentRevenueStats> {
  const base = await getExperimentStats(expId);
  const { prisma } = await import("@advance-ecommerce/db");
  const rows = await prisma.trackingEvent.findMany({
    where: { eventName: { startsWith: `AB:${expId}:` }, orderId: { not: null } },
    select: { eventName: true, orderId: true },
  });
  const orderIdsByVariant = new Map<string, string[]>();
  for (const row of rows) {
    const parts = row.eventName.split(":");
    if (parts.length !== 4 || parts[3] !== "conversion" || row.orderId === null) continue;
    const list = orderIdsByVariant.get(parts[2] as string) ?? [];
    list.push(row.orderId);
    orderIdsByVariant.set(parts[2] as string, list);
  }
  const allOrderIds = [...orderIdsByVariant.values()].flat();
  const totals = new Map<string, number>();
  if (allOrderIds.length > 0) {
    const orders = await prisma.order.findMany({
      where: { id: { in: allOrderIds } },
      select: { id: true, totalPoisha: true },
    });
    for (const order of orders) totals.set(order.id, order.totalPoisha);
  }
  return {
    expId,
    variants: base.variants.map((v) => {
      const revenuePoisha = (orderIdsByVariant.get(v.variantKey) ?? []).reduce(
        (sum, id) => sum + (totals.get(id) ?? 0),
        0,
      );
      return {
        ...v,
        revenuePoisha,
        revenuePerVisitorPoisha: v.exposures > 0 ? Math.round(revenuePoisha / v.exposures) : null,
      };
    }),
    note: "raw_counts_only",
  };
}
