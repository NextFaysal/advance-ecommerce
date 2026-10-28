/**
 * Funnel runtime helpers — doc 34 §3.7/§3.8 (wave L7).
 *
 * The shared server-side pieces of the public funnel runtime and
 * the orders-route funnel seam:
 *
 *   - getPublishedStepPage — the published-only page gate BY ID
 *     (status PUBLISHED + the v2 schedule window, mirroring
 *     landingStore.getPublishedBySlug's read semantics). A funnel
 *     step pointing at a draft/archived/out-of-window page resolves
 *     to undefined here and the step route 404s identically — a
 *     draft page never leaks through a funnel. (Stricter than the
 *     plan's §0.1 "publishable" wording on purpose: publish
 *     validation proves step pages publish-READY; the public gate
 *     still requires them actually PUBLISHED, per the wave brief's
 *     no-leak rule.)
 *
 *   - Step-graph navigation: the sequential edge (steps[i+1]) the
 *     validator's reachability walk uses, and the public step URL
 *     builder (/f/<slug>/<stepId>, token carried as ?t=).
 *
 *   - recordFunnelStepView — the §3.8 view event
 *     (`funnel:<id>:<stepId>:view`). The public track-events HTTP
 *     intake restricts eventName to the standard enum, so — exactly
 *     like the experiments module's AB: rows — the funnel runtime
 *     writes the row server-side into the same append-only
 *     TrackingEvent table, failure-isolated: a failed analytics
 *     write never breaks a step render. One row per render (fresh
 *     eventId; the §3.8 aggregator counts renders, no dedupe).
 *
 *   - The create-time OrderNote records. The Order model has no
 *     attribution columns and OrderItem has no metadata column, so
 *     — the codebase's established seam (docs 28/29 field answers,
 *     [pod:], [pickup:]) — the durable funnel records ride the
 *     create-time OrderNote as a human line + a machine line that
 *     L9's analytics source parses back:
 *       [funnel] {"funnelId","stepId"}            — attribution
 *       [funnel-offer] {"funnelId","stepId","kind":"bump",...}
 *         — the bump line's rule + live/charged prices (§3.7: the
 *         line is recorded with its rule so refunds/recon see what
 *         was charged and why). Offer-step ACCEPTS are recorded by
 *         L8's amend runtime under its own [funnel-accept:<stepId>]
 *         marker note; both marker families are the §3.8 "line
 *         metadata" the funnel report scans.
 */
import { prisma } from "@advance-ecommerce/db";
import { landingStore } from "@/landing/store";
import type { LandingPage } from "@/landing/types";
import { funnelViewEventName } from "@/marketing/funnel-analytics";
import { generateEventId } from "@/tracking/events";
import type { Funnel, FunnelStep, OfferDiscount } from "./types";

/* ------------------------------------------------------------------ */
/* Step page gate                                                      */
/* ------------------------------------------------------------------ */

/**
 * The public gate for a funnel step's page, by id: PUBLISHED status
 * + the lazy schedule window — the exact read semantics of
 * landingStore.getPublishedBySlug, applied to an id lookup.
 */
export async function getPublishedStepPage(pageId: string): Promise<LandingPage | undefined> {
  const page = await landingStore.get(pageId);
  if (!page || page.status !== "PUBLISHED") return undefined;
  if (page.schedule) {
    const now = Date.now();
    if (page.schedule.publishAt && Date.parse(page.schedule.publishAt) > now) return undefined;
    if (page.schedule.expiresAt && Date.parse(page.schedule.expiresAt) <= now) return undefined;
  }
  return page;
}

/* ------------------------------------------------------------------ */
/* Graph navigation                                                    */
/* ------------------------------------------------------------------ */

/** The sequential next step (the validator's flow edge for
 *  landing/order steps), or null when this step is the last one. */
export function nextStepAfter(funnel: Funnel, stepId: string): FunnelStep | null {
  const idx = funnel.steps.findIndex((s) => s.id === stepId);
  if (idx === -1) return null;
  return funnel.steps[idx + 1] ?? null;
}

/** Public URL of a funnel step; the continuation token rides as ?t=
 *  when one is supplied (§3.7 routing). */
export function funnelStepUrl(slug: string, stepId: string, token?: string | null): string {
  const base = `/f/${slug}/${stepId}`;
  return token ? `${base}?t=${encodeURIComponent(token)}` : base;
}

/** Deep equality for discount rules (the bump claim re-check: the
 *  claim's rule must still be the step's stored rule). */
export function offerDiscountsEqual(a: OfferDiscount | null, b: OfferDiscount | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "percent"
    ? a.pct === (b as { kind: "percent"; pct: number }).pct
    : a.poisha === (b as { kind: "fixed"; poisha: number }).poisha;
}

/* ------------------------------------------------------------------ */
/* View events (§3.8)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Write one funnel step view event. Never throws — analytics must
 * not break a render; failures are logged server-side only.
 */
export async function recordFunnelStepView(funnelId: string, stepId: string): Promise<void> {
  try {
    await prisma.trackingEvent.create({
      data: {
        eventId: generateEventId(),
        eventName: funnelViewEventName(funnelId, stepId),
        occurredAt: new Date(),
      },
    });
  } catch (e) {
    console.error("[funnels] step view event write failed", e);
  }
}

/* ------------------------------------------------------------------ */
/* OrderNote records (attribution + bump line metadata)                */
/* ------------------------------------------------------------------ */

export interface FunnelAttributionRecord {
  funnelId: string;
  stepId: string;
}

export const FUNNEL_ATTRIBUTION_MARKER = "[funnel] ";

/** Create-time note text for a funnel order: one human line + the
 *  `[funnel] {json}` machine line L9's attributed-orders source
 *  parses back. */
export function funnelAttributionNoteText(record: FunnelAttributionRecord): string {
  const human =
    `ফানেল অর্ডার: ফানেল ${record.funnelId}, অর্ডার ধাপ ${record.stepId}। ` +
    `/ Funnel order: funnel ${record.funnelId}, order step ${record.stepId}.`;
  return `${human}\n${FUNNEL_ATTRIBUTION_MARKER}${JSON.stringify(record)}`;
}

/** Parse the attribution record back out of an order note's text. */
export function funnelAttributionFromNoteText(text: string): FunnelAttributionRecord | null {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(FUNNEL_ATTRIBUTION_MARKER)) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(FUNNEL_ATTRIBUTION_MARKER.length)) as Partial<FunnelAttributionRecord>;
      if (typeof parsed.funnelId === "string" && parsed.funnelId && typeof parsed.stepId === "string" && parsed.stepId) {
        return { funnelId: parsed.funnelId, stepId: parsed.stepId };
      }
    } catch {
      // A malformed machine line is ignored — the human line remains.
    }
  }
  return null;
}

export interface FunnelOfferLineRecord {
  funnelId: string;
  stepId: string;
  /** "bump" for the order-step bump (L7); offer-step accepts are
   *  recorded by L8 under [funnel-accept:<stepId>] instead. */
  kind: "bump" | "upsell" | "downsell";
  variantId: string;
  /** The rule that priced the line (null = full live price). */
  discount: OfferDiscount | null;
  /** Live catalog price at order time, integer poisha. */
  livePricePoisha: number;
  /** What the line actually charged per unit, integer poisha. */
  chargedPoisha: number;
}

export const FUNNEL_OFFER_MARKER = "[funnel-offer] ";

function offerRuleTextBn(discount: OfferDiscount | null): string {
  if (!discount) return "ছাড় ছাড়া (পূর্ণ দামে)";
  return discount.kind === "percent" ? `${discount.pct}% ছাড়` : `${discount.poisha} পয়সা ছাড়`;
}

function offerRuleTextEn(discount: OfferDiscount | null): string {
  if (!discount) return "no discount (full price)";
  return discount.kind === "percent" ? `${discount.pct}% off` : `${discount.poisha} poisha off`;
}

/** Create-time note text for a funnel offer line (the bump): one
 *  human line + the `[funnel-offer] {json}` machine line. */
export function funnelOfferNoteText(record: FunnelOfferLineRecord, productName: string): string {
  const human =
    `ফানেল বাম্প অফার যোগ হয়েছে: ${productName} — ক্যাটালগ দাম ${record.livePricePoisha} পয়সা → নেওয়া হয়েছে ${record.chargedPoisha} পয়সা (${offerRuleTextBn(record.discount)})। ` +
    `/ Funnel bump offer added: ${productName} — catalog ${record.livePricePoisha} poisha → charged ${record.chargedPoisha} poisha (${offerRuleTextEn(record.discount)}).`;
  return `${human}\n${FUNNEL_OFFER_MARKER}${JSON.stringify(record)}`;
}

/** Parse every funnel offer line record out of an order note's text. */
export function funnelOfferLinesFromNoteText(text: string): FunnelOfferLineRecord[] {
  const out: FunnelOfferLineRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(FUNNEL_OFFER_MARKER)) continue;
    try {
      const parsed = JSON.parse(trimmed.slice(FUNNEL_OFFER_MARKER.length)) as Partial<FunnelOfferLineRecord>;
      if (
        typeof parsed.funnelId === "string" && parsed.funnelId &&
        typeof parsed.stepId === "string" && parsed.stepId &&
        (parsed.kind === "bump" || parsed.kind === "upsell" || parsed.kind === "downsell") &&
        typeof parsed.variantId === "string" && parsed.variantId &&
        typeof parsed.livePricePoisha === "number" &&
        typeof parsed.chargedPoisha === "number"
      ) {
        out.push({
          funnelId: parsed.funnelId,
          stepId: parsed.stepId,
          kind: parsed.kind,
          variantId: parsed.variantId,
          discount: parsed.discount ?? null,
          livePricePoisha: parsed.livePricePoisha,
          chargedPoisha: parsed.chargedPoisha,
        });
      }
    } catch {
      // Malformed machine lines are ignored.
    }
  }
  return out;
}
