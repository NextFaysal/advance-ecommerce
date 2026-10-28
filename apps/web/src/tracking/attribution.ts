// UTM attribution — Agent 24.
// Storage shape: two touch points per visitor/customer — first-touch (the
// campaign that first brought them, never overwritten) and last-touch (the
// most recent campaign before the action, overwritten on each new UTM
// visit). Order assignment: the order is attributed to LAST-touch (default
// reporting model), with first-touch preserved on the record for
// first-touch reporting. Money totals are integer poisha.
export interface UtmParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export const EMPTY_UTM: UtmParams = {
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmTerm: null,
  utmContent: null,
};

function clean(value: string | null | undefined): string | null {
  const v = (value ?? "").trim();
  return v === "" ? null : v;
}

export function normalizeUtm(input: Partial<UtmParams>): UtmParams {
  return {
    utmSource: clean(input.utmSource),
    utmMedium: clean(input.utmMedium),
    utmCampaign: clean(input.utmCampaign),
    utmTerm: clean(input.utmTerm),
    utmContent: clean(input.utmContent),
  };
}

export function hasAnyUtm(utm: UtmParams): boolean {
  return utm.utmSource !== null || utm.utmMedium !== null || utm.utmCampaign !== null;
}

/** Parses UTM params out of a landing URL's query string. */
export function parseUtmFromUrl(url: string): UtmParams {
  try {
    const parsed = new URL(url);
    return normalizeUtm({
      utmSource: parsed.searchParams.get("utm_source"),
      utmMedium: parsed.searchParams.get("utm_medium"),
      utmCampaign: parsed.searchParams.get("utm_campaign"),
      utmTerm: parsed.searchParams.get("utm_term"),
      utmContent: parsed.searchParams.get("utm_content"),
    });
  } catch {
    return { ...EMPTY_UTM };
  }
}

export interface TouchPoint extends UtmParams {
  landingUrl: string | null;
  capturedAt: string;
}

export interface AttributionTouches {
  firstTouch: TouchPoint | null;
  lastTouch: TouchPoint | null;
}

export const EMPTY_TOUCHES: AttributionTouches = { firstTouch: null, lastTouch: null };

/**
 * Pure touch capture: a visit WITH utm params sets first-touch if empty and
 * always refreshes last-touch. A visit without utm changes nothing (direct
 * visits never erase campaign attribution).
 */
export function captureTouch(
  touches: AttributionTouches,
  utm: UtmParams,
  landingUrl: string | null,
  capturedAt: string,
): AttributionTouches {
  if (!hasAnyUtm(utm)) return touches;
  const touch: TouchPoint = { ...utm, landingUrl, capturedAt };
  return {
    firstTouch: touches.firstTouch ?? touch,
    lastTouch: touch,
  };
}

export interface OrderAttribution {
  /** Reporting default: last-touch. */
  model: "last_touch";
  attributed: UtmParams;
  firstTouch: UtmParams;
  lastTouch: UtmParams;
  /** Doc 34 §3.8 (additive, optional): the funnel + step an order
   *  was created inside, populated from the funnel token at order
   *  create by the funnel layer. Absent on every non-funnel order —
   *  existing records and callers are unaffected. */
  funnelId?: string | null;
  stepId?: string | null;
}

export function assignOrderAttribution(
  touches: AttributionTouches,
  funnel?: { funnelId: string; stepId: string } | null,
): OrderAttribution {
  const last: UtmParams = touches.lastTouch ?? { ...EMPTY_UTM };
  const first: UtmParams = touches.firstTouch ?? { ...EMPTY_UTM };
  const base: OrderAttribution = { model: "last_touch", attributed: last, firstTouch: first, lastTouch: last };
  // Keys are set only when a funnel context is actually passed, so
  // the returned shape for existing callers is byte-identical.
  if (funnel) {
    base.funnelId = funnel.funnelId;
    base.stepId = funnel.stepId;
  }
  return base;
}

/* ------------------------------------------------------------------ */
/* Campaign report aggregation                                         */
/* ------------------------------------------------------------------ */

export interface AttributedOrderRow {
  orderId: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** Integer poisha (order total attributed to the campaign). */
  revenuePoisha: number;
}

export interface CampaignReportRow {
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  orders: number;
  revenuePoisha: number;
}

const NONE = "(none)";

export function aggregateCampaignReport(rows: AttributedOrderRow[]): CampaignReportRow[] {
  const byKey = new Map<string, CampaignReportRow>();
  for (const row of rows) {
    const source = row.utmSource ?? NONE;
    const medium = row.utmMedium ?? NONE;
    const campaign = row.utmCampaign ?? NONE;
    const key = `${source}${medium}${campaign}`;
    const entry = byKey.get(key) ?? { utmSource: source, utmMedium: medium, utmCampaign: campaign, orders: 0, revenuePoisha: 0 };
    entry.orders += 1;
    entry.revenuePoisha += row.revenuePoisha;
    byKey.set(key, entry);
  }
  return Array.from(byKey.values()).sort((a, b) => b.revenuePoisha - a.revenuePoisha);
}
