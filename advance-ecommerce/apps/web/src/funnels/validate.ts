// Funnel validation — doc 34 §3.7/§3.8. Pure functions only.
// Two layers, mirroring the landing split:
//   1. validateFunnelGraph() — everything checkable WITHOUT the DB
//      or catalog: slug, step shape, and the step-GRAPH rules.
//   2. Publish validation (in store.ts) — graph + every step page
//      exists and itself passes validateLandingPage + every offer
//      resolves in the live catalog. Publishing requires both.
import { z } from "zod";
import { landingSlugSchema } from "@/landing/validate";
import type { Funnel, FunnelStatus, FunnelStep } from "./types";

// ---- Zod input schemas ---------------------------------------------------

const offerDiscountSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("percent"), pct: z.number().int() }),
  z.object({ kind: z.literal("fixed"), poisha: z.number().int() }),
]);

const stepOfferSchema = z.object({
  productId: z.string(),
  variantId: z.string().nullable(),
  discount: offerDiscountSchema.nullable(),
});

const bumpOfferSchema = stepOfferSchema.extend({
  headingBn: z.string(),
  headingEn: z.string(),
});

export const funnelStepSchema: z.ZodType<FunnelStep> = z.discriminatedUnion("kind", [
  z.object({ id: z.string().min(1), kind: z.literal("landing"), pageId: z.string() }),
  z.object({ id: z.string().min(1), kind: z.literal("order"), pageId: z.string(), bump: bumpOfferSchema.optional() }),
  z.object({
    id: z.string().min(1), kind: z.literal("upsell"), pageId: z.string(),
    offer: stepOfferSchema, acceptStepId: z.string(), declineStepId: z.string(),
  }),
  z.object({
    id: z.string().min(1), kind: z.literal("downsell"), pageId: z.string(),
    offer: stepOfferSchema, acceptStepId: z.string(), declineStepId: z.string(),
  }),
  z.object({ id: z.string().min(1), kind: z.literal("thank_you"), pageId: z.string() }),
]);

export const funnelInputSchema = z.object({
  name: z.string().min(1),
  slug: landingSlugSchema,
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("DRAFT"),
  steps: z.array(funnelStepSchema),
});
export type FunnelInput = z.infer<typeof funnelInputSchema>;

// ---- Graph validation ------------------------------------------------------

export interface FunnelValidationError {
  code: string;
  messageBn: string;
  messageEn: string;
  stepId?: string;
}

export interface FunnelValidationResult {
  ok: boolean;
  errors: FunnelValidationError[];
}

function checkOffer(
  offer: { productId: string; discount: { kind: "percent"; pct: number } | { kind: "fixed"; poisha: number } | null },
  stepId: string,
  err: (code: string, bn: string, en: string, stepId?: string) => void,
): void {
  if (!offer.productId.trim()) {
    err("OFFER_PRODUCT_REQUIRED", "অফারের পণ্য বাছাই করা হয়নি।", "The offer has no product selected.", stepId);
  }
  if (offer.discount?.kind === "percent" && (offer.discount.pct < 1 || offer.discount.pct > 90)) {
    err("DISCOUNT_PCT_RANGE", "শতকরা ছাড় ১–৯০ এর মধ্যে হতে হবে।", "Percent discount must be between 1 and 90.", stepId);
  }
  if (offer.discount?.kind === "fixed" && offer.discount.poisha < 1) {
    err("DISCOUNT_FIXED_INVALID", "নির্দিষ্ট ছাড় অন্তত ১ পয়সা হতে হবে।", "Fixed discount must be at least 1 poisha.", stepId);
  }
}

/**
 * The step-graph rules (doc 34 §3.7/§3.8):
 * - slug kebab + unique vs `otherSlugs`; name present; >= 1 step.
 * - step ids unique; every step references a page (non-empty pageId —
 *   EXISTENCE is publish validation's job, in the store).
 * - exactly one entry step: steps[0] must be a landing step.
 * - at least one order step; offer steps (upsell/downsell) may only
 *   appear AFTER the first order step.
 * - thank_you is terminal: at most one, and it must be the last step.
 * - offer accept/decline targets exist, are not the step itself, and
 *   point FORWARD (later in the array) — targets may never point at
 *   the step itself or at earlier steps.
 * - no cycles, no orphans: accept/decline targets must point
 *   FORWARD (never at the step itself or an earlier step) and the
 *   sequential edges also only move forward, so the flow graph is
 *   acyclic by construction; a reachability walk from the entry
 *   must then visit every step (a step no edge points at can never
 *   be shown to a customer).
 * - discount bounds: percent 1–90, fixed >= 1 poisha (the
 *   fixed < live-price half of the rule needs the catalog — publish
 *   validation in the store).
 */
export function validateFunnelGraph(
  funnel: Pick<Funnel, "slug" | "name" | "steps">,
  otherSlugs: readonly string[] = [],
): FunnelValidationResult {
  const errors: FunnelValidationError[] = [];
  const err = (code: string, messageBn: string, messageEn: string, stepId?: string) =>
    errors.push({ code, messageBn, messageEn, stepId });

  if (!landingSlugSchema.safeParse(funnel.slug).success) {
    err("SLUG_NOT_KEBAB", "স্লাগ অবশ্যই ছোট হাতের kebab-case হতে হবে (যেমন eid-bundle-funnel)।", "Slug must be lowercase kebab-case.");
  } else if (otherSlugs.includes(funnel.slug)) {
    err("SLUG_NOT_UNIQUE", "এই স্লাগে ইতিমধ্যে আরেকটি ফানেল আছে।", "A funnel with this slug already exists.");
  }
  if (!funnel.name.trim()) {
    err("NAME_REQUIRED", "ফানেলের নাম আবশ্যক।", "Funnel name is required.");
  }

  const steps = funnel.steps;
  if (steps.length === 0) {
    err("STEPS_REQUIRED", "ফানেলে অন্তত একটি ধাপ আবশ্যক।", "A funnel needs at least one step.");
    return { ok: false, errors };
  }

  const indexById = new Map<string, number>();
  steps.forEach((step, i) => {
    if (indexById.has(step.id)) {
      err("DUPLICATE_STEP_ID", "দুটি ধাপের আইডি এক হয়ে গেছে।", "Duplicate step id.", step.id);
    } else {
      indexById.set(step.id, i);
    }
    if (!step.pageId.trim()) {
      err("STEP_PAGE_REQUIRED", "প্রতিটি ধাপে একটি ল্যান্ডিং পেজ থাকতে হবে।", "Every step must reference a landing page.", step.id);
    }
  });

  // Entry: exactly one, and it is the first step.
  if (steps[0].kind !== "landing") {
    err("ENTRY_STEP_MUST_BE_LANDING", "ফানেলের প্রথম ধাপ অবশ্যই একটি ল্যান্ডিং ধাপ হতে হবে।", "The first step of a funnel must be a landing step.", steps[0].id);
  }

  const firstOrderIdx = steps.findIndex((s) => s.kind === "order");
  if (firstOrderIdx === -1) {
    err("ORDER_STEP_REQUIRED", "ফানেলে অন্তত একটি অর্ডার ধাপ আবশ্যক।", "A funnel needs at least one order step.");
  }

  const thankYouIdxs = steps.map((s, i) => (s.kind === "thank_you" ? i : -1)).filter((i) => i >= 0);
  if (thankYouIdxs.length > 1) {
    err("MULTIPLE_THANK_YOU", "একটি ফানেলে একটি মাত্র ধন্যবাদ ধাপ থাকতে পারে।", "A funnel can have only one thank-you step.");
  } else if (thankYouIdxs.length === 1 && thankYouIdxs[0] !== steps.length - 1) {
    err("THANK_YOU_NOT_TERMINAL", "ধন্যবাদ ধাপ অবশ্যই ফানেলের শেষ ধাপ হতে হবে।", "The thank-you step must be the last step.", steps[thankYouIdxs[0]].id);
  }

  for (const [i, step] of steps.entries()) {
    if (step.kind === "order" && step.bump) {
      checkOffer(step.bump, step.id, err);
      if (!step.bump.headingBn.trim()) {
        err("BUMP_HEADING_REQUIRED", "বাম্প অফারের বাংলা শিরোনাম আবশ্যক।", "The bump offer needs a Bangla heading.", step.id);
      }
    }
    if (step.kind === "upsell" || step.kind === "downsell") {
      if (firstOrderIdx !== -1 && i < firstOrderIdx) {
        err("OFFER_BEFORE_ORDER", "অফার ধাপ অবশ্যই অর্ডার ধাপের পরে আসতে হবে।", "An offer step must come after the order step.", step.id);
      }
      checkOffer(step.offer, step.id, err);
      for (const [field, targetId] of [["acceptStepId", step.acceptStepId], ["declineStepId", step.declineStepId]] as const) {
        const targetIdx = indexById.get(targetId);
        if (targetIdx === undefined) {
          err("TARGET_NOT_FOUND", `অফারের ${field === "acceptStepId" ? "গ্রহণ" : "প্রত্যাখ্যান"} লক্ষ্য ধাপটি পাওয়া যায়নি।`, `The offer's ${field} target step does not exist.`, step.id);
        } else if (targetId === step.id) {
          err("TARGET_IS_SELF", "অফার ধাপ নিজেকেই লক্ষ্য করতে পারে না।", "An offer step cannot target itself.", step.id);
        } else if (targetIdx <= i) {
          err("TARGET_NOT_FORWARD", "অফারের লক্ষ্য অবশ্যই পরের ধাপ হতে হবে (আগের ধাপ নয়)।", "Offer targets must point to a later step.", step.id);
        }
      }
    }
  }

  // Reachability walk: entry -> ... following the flow edges
  // (sequential next-step for landing/order steps, accept/decline
  // for offer steps, none for thank_you) must reach every step.
  // Cycle-freedom is already proven constructively above — every
  // edge points to a strictly later array index — so this walk's
  // job is the orphan check: a step sitting after an offer step
  // that no accept/decline target points at can never be shown.
  const edges = (step: FunnelStep, i: number): number[] => {
    if (step.kind === "upsell" || step.kind === "downsell") {
      const out: number[] = [];
      for (const t of [step.acceptStepId, step.declineStepId]) {
        const ti = indexById.get(t);
        if (ti !== undefined) out.push(ti);
      }
      return out;
    }
    if (step.kind === "thank_you") return [];
    return i + 1 < steps.length ? [i + 1] : [];
  };
  const visited = new Set<number>();
  const stack = [0];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue; // diamond re-visit (two paths, one step) — legal
    visited.add(cur);
    for (const nxt of edges(steps[cur], cur)) stack.push(nxt);
  }
  if (visited.size !== steps.length) {
    const orphan = steps.find((_, i) => !visited.has(i));
    err("STEP_UNREACHABLE", "একটি ধাপ ফানেলের প্রবাহ থেকে পৌঁছানো যায় না।", "A step cannot be reached from the funnel entry.", orphan?.id);
  }

  return { ok: errors.length === 0, errors };
}

// ---- Status flow -----------------------------------------------------------
// Same lifecycle shape as landing pages: DRAFT -> PUBLISHED ->
// ARCHIVED, with unpublish (PUBLISHED -> DRAFT) and restore
// (ARCHIVED -> DRAFT) allowed. Only PUBLISHED funnels route publicly.

const ALLOWED: Record<FunnelStatus, readonly FunnelStatus[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["ARCHIVED", "DRAFT"],
  ARCHIVED: ["DRAFT"],
};

export function canTransitionFunnel(from: FunnelStatus, to: FunnelStatus): boolean {
  return from === to || ALLOWED[from].includes(to);
}
