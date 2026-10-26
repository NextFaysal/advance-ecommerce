/**
 * Funnel event aggregation — ADV-8 (doc 22). The read side of the
 * sales funnel over PERSISTED storefront tracking events.
 *
 * HISTORY: until wave 38, tracking events did not persist anywhere
 * queryable (the track-events route validated, deduped IN MEMORY and
 * dispatched to Meta CAPI only). Wave 38 landed the TrackingEvent
 * table (migration 20261026014000_tracking_events) + the append-only
 * write in the track-events route, and resolveFunnelEventStore() now
 * returns the Prisma-backed store below: rows of { eventId,
 * eventName, orderId, occurredAt } — ids + event name + order ref +
 * timestamp ONLY (no PII; phone/email stay hashed-inside-CAPI as
 * before). Callers must still surface read failures as "not
 * collecting" (তথ্য সংগ্রহ শুরু হয়নি) — never zeros dressed up as
 * data, never estimates. Periods before wave 38 have no rows and the
 * funnel honestly shows nothing for them.
 */
import { buildFunnel, type FunnelCounts, type FunnelStep } from "./funnel";
import type { DateRange } from "../reports/types";

/** One persisted tracking event row (the future TrackingEvent shape). */
export interface PersistedTrackingEvent {
  /** Shared pixel/CAPI dedup id — replays carry the same id. */
  eventId: string;
  /** Standard event name (src/tracking/types STANDARD_EVENT_NAMES). */
  eventName: string;
  /** Order ref for Purchase events; null otherwise. */
  orderId: string | null;
  /** ISO timestamp of when the event occurred. */
  occurredAt: string;
}

/**
 * Standard event name -> funnel stage. PageView is deliberately NOT
 * the "view" stage: the funnel measures product-view intent
 * (ViewContent), matching funnel.ts + the marketing outline mapping
 * (STANDARD_TO_MARKETING_EVENT). Lead / CompleteRegistration are not
 * commerce-funnel stages.
 */
export const FUNNEL_STAGE_BY_EVENT: Readonly<Record<string, keyof FunnelCounts | undefined>> = {
  ViewContent: "view",
  AddToCart: "cart",
  InitiateCheckout: "checkout",
  Purchase: "order",
};

/** Dhaka calendar date (YYYY-MM-DD) of an ISO instant. BD is UTC+6. */
function dhakaDateOfIso(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + 6 * 3600_000).toISOString().slice(0, 10);
}

/**
 * Count funnel stages over persisted events inside a Dhaka date range.
 * Dedupes on eventId (pixel + CAPI share one id — a replayed event is
 * ONE event), skips events with no funnel stage, and counts an event
 * once even if its payload was recorded twice.
 */
export function aggregateFunnelCounts(
  events: readonly PersistedTrackingEvent[],
  range: DateRange,
): FunnelCounts {
  const counts: FunnelCounts = { view: 0, cart: 0, checkout: 0, order: 0 };
  const seen = new Set<string>();
  for (const e of events) {
    const stage = FUNNEL_STAGE_BY_EVENT[e.eventName];
    if (stage === undefined) continue;
    if (seen.has(e.eventId)) continue;
    const date = dhakaDateOfIso(e.occurredAt);
    if (date < range.from || date > range.to) continue;
    seen.add(e.eventId);
    counts[stage] += 1;
  }
  return counts;
}

/** What the admin surfaces render for the funnel. */
export type FunnelData =
  | {
      state: "ready";
      counts: FunnelCounts;
      steps: FunnelStep[];
    }
  | {
      state: "not_collecting";
      /** Machine reason — today always "event-store-missing". */
      reason: "event-store-missing";
      /** Human copy for the empty state (Bangla, matches page style). */
      messageBn: string;
    };

export const FUNNEL_NOT_COLLECTING_BN =
  "তথ্য সংগ্রহ শুরু হয়নি — স্টোরফ্রন্ট ট্র্যাকিং ইভেন্ট এখনো ডাটাবেসে সংরক্ষিত হয় না (শুধু Meta CAPI-তে পাঠানো হয়)। ইভেন্ট-স্টোর টেবিল তৈরি হলেই এই ফানেল আসল সংখ্যা দেখাবে; ততক্ষণ কোনো অনুমান দেখানো হচ্ছে না।";

/** Read seam for persisted events. Implemented by the future
 *  Prisma-backed store once the TrackingEvent table exists. */
export interface FunnelEventStore {
  listEvents(range: DateRange): Promise<PersistedTrackingEvent[]>;
}

/** The production store resolver (wave 38): Prisma-backed over the
 *  TrackingEvent table; read failures surface as not-collecting via
 *  FunnelStoreUnavailableError, never as zeros. */
export function resolveFunnelEventStore(): FunnelEventStore | null {
  // Parent integration (wave 38): the TrackingEvent table now exists
  // (migration 20261026014000_tracking_events) and the track-events
  // route appends every accepted event. The store pre-filters with a
  // ±1 day window; aggregateFunnelCounts applies the exact Dhaka-day
  // range. A DB failure throws FunnelStoreUnavailableError, which
  // getFunnelData turns back into the honest not-collecting state —
  // never zeros dressed up as data.
  return {
    async listEvents(range: DateRange): Promise<PersistedTrackingEvent[]> {
      try {
        const { prisma } = await import("@advance-ecommerce/db");
        const rows = await prisma.trackingEvent.findMany({
          where: {
            occurredAt: {
              gte: new Date(new Date(`${range.from}T00:00:00.000Z`).getTime() - 86_400_000),
              lte: new Date(new Date(`${range.to}T23:59:59.999Z`).getTime() + 86_400_000),
            },
          },
          select: { eventId: true, eventName: true, orderId: true, occurredAt: true },
          orderBy: { occurredAt: "asc" },
        });
        return rows.map((r) => ({
          eventId: r.eventId,
          eventName: r.eventName,
          orderId: r.orderId,
          occurredAt: r.occurredAt.toISOString(),
        }));
      } catch (error) {
        throw new FunnelStoreUnavailableError(error);
      }
    },
  };
}

/** Thrown by the production store when the events table cannot be
 *  read (migration not applied, DB down). getFunnelData maps it to
 *  the honest not-collecting state. */
export class FunnelStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super("tracking event store unavailable");
    this.name = "FunnelStoreUnavailableError";
    this.cause = cause;
  }
}

/** Funnel for a range over an injected store (null store = the
 *  honest not-collecting state). */
export async function getFunnelData(
  range: DateRange,
  store: FunnelEventStore | null,
): Promise<FunnelData> {
  if (store === null) {
    return { state: "not_collecting", reason: "event-store-missing", messageBn: FUNNEL_NOT_COLLECTING_BN };
  }
  let events: PersistedTrackingEvent[];
  try {
    events = await store.listEvents(range);
  } catch {
    return { state: "not_collecting", reason: "event-store-missing", messageBn: FUNNEL_NOT_COLLECTING_BN };
  }
  const counts = aggregateFunnelCounts(events, range);
  return { state: "ready", counts, steps: buildFunnel(counts) };
}
