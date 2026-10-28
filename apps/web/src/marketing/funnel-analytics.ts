/**
 * Funnel analytics — doc 34 §3.8 (the L9 read side, prepared ahead
 * of the funnel layer).
 *
 * The admin funnel page reports a per-step table — views → orders
 * → revenue, accept-rate per offer step — computed from two real
 * sources: TrackingEvent view rows and attributed order rows. This
 * module owns the CONTRACTS for both plus a pure aggregator in the
 * `aggregateCampaignReport` pattern (src/tracking/attribution.ts):
 * raw counts + descriptive percentages ONLY — no significance, no
 * winner claims (the experiments module's standing honesty rule,
 * plan §5.7). Revenue is the attributed orders' totals read from
 * the order rows, labelled `attributed_order_totals`, never
 * re-derived here.
 *
 * Event contract (§3.8): a funnel step render writes a
 * TrackingEvent named `funnel:<funnelId>:<stepId>:view` through the
 * existing intake rules. funnelId/stepId never contain ":" (slug /
 * step-key charsets), so the name parses unambiguously.
 *
 * Data access: view events have a real reader below
 * (`loadFunnelViewEvents`, same startsWith pattern the experiments
 * stats use). Steps + attributed orders are supplied through the
 * `FunnelAnalyticsSource` adapter: they belong to the Funnel model
 * and the order-attribution plumbing the funnel waves (L7/L9) own,
 * so this module defines the shapes (§3.8) instead of inventing a
 * schema. `getFunnelAnalytics` composes a source + the aggregator.
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Step kinds from the §3.7 funnel graph. */
export const FUNNEL_STEP_KINDS = ["landing", "order", "upsell", "downsell", "thank_you"] as const;
export type FunnelStepKind = (typeof FUNNEL_STEP_KINDS)[number];

/** Offer steps are the ones an accept-rate is meaningful for: the
 *  visitor is shown one offer and accepts or declines. (The order
 *  bump is NOT a step kind — it renders inside the order step — so
 *  it has no row here; its lines are visible in the order's own
 *  metadata, per §3.7.) */
export const FUNNEL_OFFER_STEP_KINDS: ReadonlySet<FunnelStepKind> = new Set(["upsell", "downsell"]);

export interface FunnelStepDescriptor {
  stepId: string;
  kind: FunnelStepKind;
}

export interface FunnelViewEvent {
  funnelId: string;
  stepId: string;
  /** ae_vid visitor id when the writer carried one; the
   *  TrackingEvent table has no visitor column, so readers over
   *  the table itself yield null (see loadFunnelViewEvents). */
  visitorId: string | null;
  occurredAt: Date;
}

/** One order attributed to a funnel (its OrderAttribution carries
 *  funnelId/stepId — src/tracking/attribution.ts). */
export interface FunnelAttributedOrderRow {
  orderId: string;
  /** The funnel ORDER step the order was created at. */
  stepId: string;
  /** The order's total, integer poisha, read from the order row. */
  revenuePoisha: number;
  /** Offer steps whose bump/upsell line landed on this order —
   *  distinguishable by line metadata per §3.8. Empty when the
   *  customer accepted nothing. */
  acceptedOfferStepIds: string[];
}

export const funnelStepDescriptorSchema = z.object({
  stepId: z.string().min(1).max(60),
  kind: z.enum(FUNNEL_STEP_KINDS),
});

/* ------------------------------------------------------------------ */
/* View-event name encoding (§3.8)                                     */
/* ------------------------------------------------------------------ */

export function funnelViewEventName(funnelId: string, stepId: string): string {
  return `funnel:${funnelId}:${stepId}:view`;
}

export function parseFunnelViewEventName(eventName: string): { funnelId: string; stepId: string } | null {
  const parts = eventName.split(":");
  if (parts.length !== 4 || parts[0] !== "funnel" || parts[3] !== "view") return null;
  const funnelId = parts[1] as string;
  const stepId = parts[2] as string;
  if (funnelId === "" || stepId === "") return null;
  return { funnelId, stepId };
}

/* ------------------------------------------------------------------ */
/* Aggregation — pure, raw counts only                                 */
/* ------------------------------------------------------------------ */

export interface FunnelStepReportRow {
  stepId: string;
  kind: FunnelStepKind;
  /** Step render events (every render counts; not deduped). */
  views: number;
  /** Distinct visitor ids among the view events, or null when no
   *  event carried one — never a fabricated number. */
  uniqueVisitors: number | null;
  /** Orders created AT this step (non-zero only on order steps). */
  orders: number;
  /** Totals of those orders, integer poisha. */
  revenuePoisha: number;
  /** Offer steps only: orders carrying this step's accepted line. */
  acceptedCount: number | null;
  /** Offer steps only: acceptedCount / views × 100 (2dp). A
   *  post-order offer step is rendered once per arriving order, so
   *  views ≈ offers shown. Null when the step is not an offer step
   *  or has no views yet. Descriptive only. */
  acceptRatePercent: number | null;
}

export interface FunnelReport {
  funnelId: string;
  steps: FunnelStepReportRow[];
  totalViews: number;
  totalOrders: number;
  totalRevenuePoisha: number;
  /** Views/orders whose stepId is not in the descriptor list
   *  (e.g. a step removed after traffic) — counted, never dropped
   *  silently and never attributed to a wrong step. */
  orphanedViews: number;
  orphanedOrders: number;
  note: "raw_counts_only";
  revenueBasis: "attributed_order_totals";
}

export interface FunnelAggregationInput {
  funnelId: string;
  steps: FunnelStepDescriptor[];
  views: FunnelViewEvent[];
  orders: FunnelAttributedOrderRow[];
}

export function aggregateFunnelReport(input: FunnelAggregationInput): FunnelReport {
  const rows = new Map<string, FunnelStepReportRow>();
  const visitors = new Map<string, Set<string>>();
  for (const step of input.steps) {
    rows.set(step.stepId, {
      stepId: step.stepId,
      kind: step.kind,
      views: 0,
      uniqueVisitors: null,
      orders: 0,
      revenuePoisha: 0,
      acceptedCount: FUNNEL_OFFER_STEP_KINDS.has(step.kind) ? 0 : null,
      acceptRatePercent: null,
    });
    visitors.set(step.stepId, new Set());
  }

  let orphanedViews = 0;
  let totalViews = 0;
  for (const view of input.views) {
    if (view.funnelId !== input.funnelId) continue;
    totalViews += 1;
    const row = rows.get(view.stepId);
    if (!row) {
      orphanedViews += 1;
      continue;
    }
    row.views += 1;
    if (view.visitorId !== null && view.visitorId !== "") visitors.get(view.stepId)?.add(view.visitorId);
  }

  let orphanedOrders = 0;
  let totalOrders = 0;
  let totalRevenuePoisha = 0;
  for (const order of input.orders) {
    totalOrders += 1;
    totalRevenuePoisha += order.revenuePoisha;
    const row = rows.get(order.stepId);
    if (!row) orphanedOrders += 1;
    else {
      row.orders += 1;
      row.revenuePoisha += order.revenuePoisha;
    }
    // An accept counts toward the OFFER step wherever the order
    // itself was created (an upsell line lands on the order made
    // at an earlier order step).
    for (const offerStepId of order.acceptedOfferStepIds) {
      const offerRow = rows.get(offerStepId);
      if (offerRow && offerRow.acceptedCount !== null) offerRow.acceptedCount += 1;
    }
  }

  const steps = input.steps.map((step) => {
    const row = rows.get(step.stepId) as FunnelStepReportRow;
    const seen = visitors.get(step.stepId);
    row.uniqueVisitors = seen !== undefined && seen.size > 0 ? seen.size : null;
    if (row.acceptedCount !== null) {
      row.acceptRatePercent =
        row.views > 0 ? Math.round((row.acceptedCount / row.views) * 10000) / 100 : null;
    }
    return row;
  });

  return {
    funnelId: input.funnelId,
    steps,
    totalViews,
    totalOrders,
    totalRevenuePoisha,
    orphanedViews,
    orphanedOrders,
    note: "raw_counts_only",
    revenueBasis: "attributed_order_totals",
  };
}

/* ------------------------------------------------------------------ */
/* Data access — adapter interface + the one real reader               */
/* ------------------------------------------------------------------ */

/** What the funnel layer (L7/L9) provides. Steps come from the
 *  Funnel envelope; attributed orders from OrderAttribution rows
 *  carrying funnelId/stepId + line metadata for accepts. */
export interface FunnelAnalyticsSource {
  listSteps(funnelId: string): Promise<FunnelStepDescriptor[]>;
  listViewEvents(funnelId: string): Promise<FunnelViewEvent[]>;
  listAttributedOrders(funnelId: string): Promise<FunnelAttributedOrderRow[]>;
}

export async function getFunnelAnalytics(funnelId: string, source: FunnelAnalyticsSource): Promise<FunnelReport> {
  const [steps, views, orders] = await Promise.all([
    source.listSteps(funnelId),
    source.listViewEvents(funnelId),
    source.listAttributedOrders(funnelId),
  ]);
  return aggregateFunnelReport({ funnelId, steps, views, orders });
}

/** Real reader for view events over the TrackingEvent table (the
 *  same startsWith scan the experiments stats use). visitorId is
 *  null: the table carries no visitor column — unique-visitor
 *  counts stay null rather than invented, until/unless the funnel
 *  writer encodes the visitor into the row it writes. */
export async function loadFunnelViewEvents(funnelId: string): Promise<FunnelViewEvent[]> {
  const { prisma } = await import("@advance-ecommerce/db");
  const rows = await prisma.trackingEvent.findMany({
    where: { eventName: { startsWith: `funnel:${funnelId}:` } },
    select: { eventName: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  const events: FunnelViewEvent[] = [];
  for (const row of rows) {
    const parsed = parseFunnelViewEventName(row.eventName);
    if (parsed === null || parsed.funnelId !== funnelId) continue;
    events.push({ funnelId: parsed.funnelId, stepId: parsed.stepId, visitorId: null, occurredAt: row.occurredAt });
  }
  return events;
}
