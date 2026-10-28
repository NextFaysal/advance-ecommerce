/**
 * Funnel analytics — the Prisma source adapter (doc 34 §3.8, L9).
 *
 * `funnel-analytics.ts` owns the pure aggregator + the
 * `FunnelAnalyticsSource` contract; this module is the REAL adapter
 * feeding it from the database, following the codebase's marketing
 * read patterns (server-only; the aggregator stays pure). The three
 * durable signals it reads — there is no attribution column on the
 * Order model and no metadata column on OrderItem, so the funnel
 * layer records everything on the create-time OrderNote (the
 * docs 28/29 machine-line seam) + the TrackingEvent table:
 *
 *   1. Steps — the Funnel row's steps envelope, read through the
 *      funnel store (the one canonical envelope reader).
 *   2. Views — TrackingEvent rows `funnel:<id>:<stepId>:view`,
 *      via the aggregator module's own `loadFunnelViewEvents`.
 *   3. Attributed orders — orders carrying the create-time note
 *      machine line `[funnel] {"funnelId","stepId"}`
 *      (src/funnels/runtime.ts — L7 writes it at order create;
 *      parsed back with that module's own parser, never a second
 *      implementation). Revenue is the order row's totalPoisha,
 *      read from the order row itself.
 *
 * Accepted offers on an attributed order are read from the same
 * order's notes: L8's `[funnel-accept:<stepId>]` markers (written
 * on the ORIGINAL order on both the amend and the held-companion
 * paths) plus any `[funnel-offer] {...}` line records for this
 * funnel (the bump's record — its stepId is the order step's, so
 * the aggregator counts it only where an accept count is
 * meaningful; the bump attach count below reads it directly).
 *
 * Honest limits, by construction:
 *   - Soft-deleted orders (deletedAt set) are excluded.
 *   - A held COMPANION order created by the fallback accept path
 *     carries no `[funnel]` attribution note, so its total is NOT
 *     folded into funnel revenue — revenue stays exactly "the
 *     attributed orders' totals", the §3.8 basis. The companion is
 *     cross-referenced on the original order's timeline instead.
 *   - An order with a malformed machine line simply does not
 *     parse — it is not attributed, never guessed into a funnel.
 */
import { prisma } from "@advance-ecommerce/db";
import { funnelStore } from "@/funnels/store";
import {
  FUNNEL_ATTRIBUTION_MARKER,
  FUNNEL_OFFER_MARKER,
  funnelAttributionFromNoteText,
  funnelOfferLinesFromNoteText,
} from "@/funnels/runtime";
import {
  getFunnelAnalytics,
  loadFunnelViewEvents,
  type FunnelAnalyticsSource,
  type FunnelAttributedOrderRow,
  type FunnelReport,
  type FunnelStepDescriptor,
} from "./funnel-analytics";

const ACCEPT_MARKER_PREFIX = "[funnel-accept:";
const ACCEPT_MARKER_RE = /\[funnel-accept:([^\]]+)\]/g;

async function listSteps(funnelId: string): Promise<FunnelStepDescriptor[]> {
  const funnel = await funnelStore.get(funnelId);
  if (!funnel) return [];
  return funnel.steps.map((step) => ({ stepId: step.id, kind: step.kind }));
}

async function listAttributedOrders(funnelId: string): Promise<FunnelAttributedOrderRow[]> {
  // 1) Attribution notes for ANY funnel → keep this funnel's orders.
  const attributionNotes = await prisma.orderNote.findMany({
    where: { text: { contains: `${FUNNEL_ATTRIBUTION_MARKER}{` } },
    select: { orderId: true, text: true },
  });
  const stepByOrder = new Map<string, string>();
  for (const note of attributionNotes) {
    const record = funnelAttributionFromNoteText(note.text);
    if (record !== null && record.funnelId === funnelId && !stepByOrder.has(note.orderId)) {
      stepByOrder.set(note.orderId, record.stepId);
    }
  }
  if (stepByOrder.size === 0) return [];

  // 2) The orders themselves — revenue is the row's own total.
  const orders = await prisma.order.findMany({
    where: { id: { in: [...stepByOrder.keys()] }, deletedAt: null },
    select: { id: true, totalPoisha: true },
  });
  if (orders.length === 0) return [];

  // 3) Accepted offers recorded on those orders' timelines.
  const acceptedByOrder = new Map<string, Set<string>>();
  const offerNotes = await prisma.orderNote.findMany({
    where: {
      orderId: { in: orders.map((o) => o.id) },
      OR: [{ text: { contains: ACCEPT_MARKER_PREFIX } }, { text: { contains: `${FUNNEL_OFFER_MARKER}{` } }],
    },
    select: { orderId: true, text: true },
  });
  for (const note of offerNotes) {
    const set = acceptedByOrder.get(note.orderId) ?? new Set<string>();
    for (const match of note.text.matchAll(ACCEPT_MARKER_RE)) {
      const stepId = match[1];
      if (stepId) set.add(stepId);
    }
    for (const record of funnelOfferLinesFromNoteText(note.text)) {
      if (record.funnelId === funnelId) set.add(record.stepId);
    }
    acceptedByOrder.set(note.orderId, set);
  }

  return orders.map((order) => ({
    orderId: order.id,
    stepId: stepByOrder.get(order.id) as string,
    revenuePoisha: order.totalPoisha,
    acceptedOfferStepIds: [...(acceptedByOrder.get(order.id) ?? [])],
  }));
}

/** The production source for the funnel report. */
export const prismaFunnelAnalyticsSource: FunnelAnalyticsSource = {
  listSteps,
  listViewEvents: loadFunnelViewEvents,
  listAttributedOrders,
};

/** The composed report the admin funnel-analytics page renders. */
export async function getFunnelAnalyticsReport(funnelId: string): Promise<FunnelReport> {
  return getFunnelAnalytics(funnelId, prismaFunnelAnalyticsSource);
}

/**
 * Bump attach counts per ORDER step: distinct orders carrying a
 * `[funnel-offer]` line record with kind "bump" for this funnel,
 * keyed by the record's stepId (the order step the bump lives on).
 * The aggregator deliberately has no bump row (the bump is not a
 * step kind), so the admin page reads this alongside the report
 * and shows attach = bumpOrders / ordersAtStep. Counts distinct
 * orders, never note rows.
 */
export async function loadFunnelBumpOrderCounts(funnelId: string): Promise<Map<string, number>> {
  const notes = await prisma.orderNote.findMany({
    where: { text: { contains: `${FUNNEL_OFFER_MARKER}{` } },
    select: { orderId: true, text: true },
  });
  const ordersByStep = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const record of funnelOfferLinesFromNoteText(note.text)) {
      if (record.funnelId !== funnelId || record.kind !== "bump") continue;
      const set = ordersByStep.get(record.stepId) ?? new Set<string>();
      set.add(note.orderId);
      ordersByStep.set(record.stepId, set);
    }
  }
  return new Map([...ordersByStep.entries()].map(([stepId, orderIds]) => [stepId, orderIds.size]));
}
