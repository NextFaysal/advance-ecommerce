// Funnel builder — types (doc 34 §3.7, CartFlows layer).
// A funnel is ORCHESTRATION ONLY: an ordered graph of steps, where
// every step's content is an ordinary LandingPage rendered by the
// ordinary LandingView. Funnels add routing + offers — never a
// second content system, never a second order path, and they store
// no prices: every offer resolves against the LIVE catalog exactly
// like landing sections do (integer poisha, computed server-side at
// order time; the discount RULE is the only thing stored here).
//
// Step pages may be shared between funnels. Funnel membership does
// NOT publish a page: a step page's own slug stays reachable at
// /lp/<slug> only if the page is independently PUBLISHED.

export type FunnelStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export type FunnelStepKind = "landing" | "order" | "upsell" | "downsell" | "thank_you";

/**
 * A discount rule attached to an offer. `percent` takes pct% off the
 * live price; `fixed` takes poisha off the live price. Bounds are
 * enforced by the validator (percent 1–90; fixed >= 1 and, at
 * publish/order time, strictly below the then-live price so a line
 * can never price at <= 0).
 */
export type OfferDiscount =
  | { kind: "percent"; pct: number }
  | { kind: "fixed"; poisha: number };

/** An offer pinned to a catalog product (+ optional variant). */
export interface StepOffer {
  /** Catalog product id — must resolve against the live catalog. */
  productId: string;
  /** Specific variant id, or null = the product's first in-stock variant. */
  variantId: string | null;
  /** Discount rule, or null = full live price. */
  discount: OfferDiscount | null;
}

/** The order-step bump: a StepOffer plus the checkbox-card heading. */
export interface BumpOffer extends StepOffer {
  headingBn: string;
  headingEn: string;
}

export type FunnelStep =
  /** Entry / content step — a LandingPage. Exactly one entry: steps[0]. */
  | { id: string; kind: "landing"; pageId: string }
  /** A LandingPage carrying a quick_order section; optional bump. */
  | { id: string; kind: "order"; pageId: string; bump?: BumpOffer }
  /** Post-order one-click offer; accept/decline are data, not code. */
  | { id: string; kind: "upsell"; pageId: string; offer: StepOffer; acceptStepId: string; declineStepId: string }
  | { id: string; kind: "downsell"; pageId: string; offer: StepOffer; acceptStepId: string; declineStepId: string }
  /** Terminal step — the flow ends here. */
  | { id: string; kind: "thank_you"; pageId: string };

export interface Funnel {
  id: string;
  /** Owner-facing name (admin lists, analytics headers). */
  name: string;
  /** Lowercase kebab-case, unique across funnels — public entry /f/<slug>. */
  slug: string;
  status: FunnelStatus;
  steps: FunnelStep[];
  createdAt: string;
  updatedAt: string;
}

export const FUNNEL_STEP_LABELS: Record<FunnelStepKind, { bn: string; en: string }> = {
  landing: { bn: "ল্যান্ডিং ধাপ", en: "Landing step" },
  order: { bn: "অর্ডার ধাপ", en: "Order step" },
  upsell: { bn: "আপসেল অফার", en: "Upsell offer" },
  downsell: { bn: "ডাউনসেল অফার", en: "Downsell offer" },
  thank_you: { bn: "ধন্যবাদ ধাপ", en: "Thank-you step" },
};

let stepCounter = 0;
/** New step id for builder-created steps (deterministic prefix + counter/random suffix). */
export function newFunnelStepId(kind: FunnelStepKind): string {
  stepCounter += 1;
  return `step_${kind}_${Date.now().toString(36)}_${stepCounter}`;
}
