// Pixel client — Agent 26 (storefront tracking client).
// Framework-agnostic core used by the React provider in ../client-components.
//
// How dedup works: track() mints ONE eventId via generateEventId() (Agent 24,
// isomorphic), sends it to POST /api/v1/public/track-events, and returns it —
// the server CAPI event for the same action must reuse THIS id (the checkout
// / order flow passes it server-side), so Meta dedupes pixel + CAPI.
//
// PII rule: this client NEVER sends a plain phone or email. ClientTrackInput
// has no user field at all — identifiers enter tracking only through the
// server checkout flow, where they are SHA-256 hashed inside the payload
// builder (../capi.ts). Do not add a user field here.
//
// NO-OP MODE: when no pixelId is configured (config.pixelId empty/null),
// the client runs in "noop-unconfigured" mode — track() still mints and
// returns an eventId and evaluates consent, but performs NO network send
// and NO queueing. There is deliberately no real Meta pixel id anywhere in
// this codebase; the id arrives only via the TrackingProvider prop, which
// the root layout fills from the public tracking settings once they exist.
import { evaluateTrackingConsent, type TrackingConsentState } from "../consent";
import { buildTrackingEvent, generateEventId } from "../events";
import type { StandardEventName, TrackingContentItem } from "../types";
import {
  readConsentState,
  subscribeConsent,
  type StoredConsentState,
} from "./consent-storage";
import { getLastTouchUtm } from "./utm-capture";
import type { UtmParams } from "../attribution";

export const TRACK_EVENTS_ENDPOINT = "/api/v1/public/track-events";

export type TrackingClientMode = "active" | "noop-unconfigured";

export interface TrackingClientConfig {
  /**
   * Primary Meta pixel id (a PUBLIC identifier, not a secret/token). Supplied by
   * the TrackingProvider prop. Supports single ID or comma-separated IDs. Empty/null => no-op mode (see header).
   */
  pixelId?: string | null;
  /**
   * Optional multiple Meta pixel IDs (e.g. backup, agency or secondary pixels).
   */
  pixelIds?: string[] | null;
  /** Intake endpoint override; defaults to the public track-events route. */
  endpoint?: string;
  /** Fetch implementation override (tests / nonstandard runtimes). */
  fetchFn?: typeof fetch;
}

/**
 * What callers may track from the browser. Intentionally has NO user /
 * phone / email field — see the PII rule in the file header.
 */
export interface ClientTrackInput {
  eventName: StandardEventName;
  /** Pre-minted shared id (e.g. from a server-rendered checkout). Minted when omitted. */
  eventId?: string;
  orderId?: string | null;
  /** Integer poisha. */
  valuePoisha?: number | null;
  items?: TrackingContentItem[];
  eventSourceUrl?: string | null;
  strictlyNecessary?: boolean;
}

export type TrackOutcome = "sent" | "queued" | "dropped" | "noop" | "failed";

export interface TrackResult {
  /** The shared eventId — pass it to the server flow for CAPI dedup. */
  eventId: string;
  mode: TrackingClientMode;
  outcome: TrackOutcome;
  consent: TrackingConsentState;
  /** True when the event went (or will go) without any user identifiers. */
  anonymous: boolean;
  /** Machine-readable reason, e.g. "consent_granted", "consent_denied". */
  reason: string;
}

/** JSON body accepted by POST /api/v1/public/track-events (Agent 24 route). */
export interface ClientEventPayload {
  eventName: StandardEventName;
  eventId: string;
  orderId: string | null;
  valuePoisha: number | null;
  items: TrackingContentItem[];
  eventSourceUrl: string | null;
  occurredAt: string;
  strictlyNecessary: boolean;
  consent: TrackingConsentState;
  utm?: UtmParams;
}

interface QueuedEvent {
  payload: ClientEventPayload;
}

const MAX_QUEUE = 50;

export interface TrackingClient {
  readonly mode: TrackingClientMode;
  readonly pixelIds: readonly string[];
  track(input: ClientTrackInput): Promise<TrackResult>;
  /** Number of events waiting for a consent decision. */
  pendingCount(): number;
  /** Sends queued events if consent now allows; drops them if denied. */
  flushPending(): Promise<void>;
}

export function createTrackingClient(config: TrackingClientConfig = {}): TrackingClient {
  const extractedIds = [
    ...(config.pixelId ? config.pixelId.split(",") : []),
    ...(config.pixelIds ?? []),
  ]
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const uniquePixelIds = Array.from(new Set(extractedIds));
  const mode: TrackingClientMode = uniquePixelIds.length > 0 ? "active" : "noop-unconfigured";
  const endpoint = config.endpoint ?? TRACK_EVENTS_ENDPOINT;
  const doFetch: typeof fetch =
    config.fetchFn ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const queue: QueuedEvent[] = [];

  function buildPayload(input: ClientTrackInput, consent: TrackingConsentState): ClientEventPayload {
    const event = buildTrackingEvent({
      eventName: input.eventName,
      eventId: input.eventId ?? generateEventId(),
      orderId: input.orderId ?? null,
      valuePoisha: input.valuePoisha ?? null,
      items: input.items,
      eventSourceUrl: input.eventSourceUrl ?? null,
      strictlyNecessary: input.strictlyNecessary ?? false,
    });
    const utm = getLastTouchUtm();
    return {
      eventName: event.eventName,
      eventId: event.dedup.eventId,
      orderId: event.dedup.orderId,
      valuePoisha: event.dedup.valuePoisha,
      items: event.items,
      eventSourceUrl: event.eventSourceUrl,
      occurredAt: event.dedup.occurredAt,
      strictlyNecessary: event.strictlyNecessary,
      consent,
      ...(utm ? { utm } : {}),
    };
  }

  async function send(payload: ClientEventPayload): Promise<boolean> {
    try {
      const res = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function flushPending(): Promise<void> {
    if (queue.length === 0) return;
    const consent = readConsentState();
    if (consent === "denied") {
      // A later denial discards everything queued while undecided —
      // queued events are never sent against a "denied" choice.
      queue.length = 0;
      return;
    }
    if (consent === "unknown") return; // Still undecided: keep waiting.
    const pending = queue.splice(0, queue.length);
    for (const { payload } of pending) {
      // Consent is stamped at send time, so flushed events carry the
      // decision that released them ("granted" here).
      await send({ ...payload, consent });
    }
  }

  // React to decisions made anywhere (banner, another tab): flush on
  // grant, discard on deny. Strictly-necessary events never enter the
  // queue (they send immediately, anonymously), so nothing in the queue
  // survives a denial.
  subscribeConsent((state: StoredConsentState | "unknown") => {
    if (state === "granted") void flushPending();
    if (state === "denied") queue.length = 0;
  });

  async function track(input: ClientTrackInput): Promise<TrackResult> {
    const consent = readConsentState();
    const payload = buildPayload(input, consent);
    const eventId = payload.eventId;
    const decision = evaluateTrackingConsent(consent, {
      strictlyNecessary: payload.strictlyNecessary,
    });

    if (mode === "noop-unconfigured") {
      // No-op mode (no pixel id configured): no network, no queue — the
      // caller still gets the shared eventId for the server flow.
      return {
        eventId,
        mode,
        outcome: "noop",
        consent,
        anonymous: decision.mode !== "full",
        reason: "pixel_not_configured_noop",
      };
    }

    if (!decision.allowed) {
      return {
        eventId,
        mode,
        outcome: "dropped",
        consent,
        anonymous: true,
        reason: decision.reason,
      };
    }

    if (consent === "unknown" && !payload.strictlyNecessary) {
      // Undecided: hold the event until the banner is answered instead of
      // sending it with identifiers the visitor may be about to refuse.
      if (queue.length >= MAX_QUEUE) queue.shift();
      queue.push({ payload });
      return {
        eventId,
        mode,
        outcome: "queued",
        consent,
        anonymous: true,
        reason: "awaiting_consent_decision",
      };
    }

    // Direct browser-side Meta Pixel (fbq) tracking with exact shared eventID for dedup
    if (typeof window !== "undefined" && typeof (window as any).fbq === "function") {
      try {
        const customData: Record<string, any> = {};
        if (payload.valuePoisha !== null) {
          customData.value = Number((payload.valuePoisha / 100).toFixed(2));
          customData.currency = "BDT";
        }
        if (payload.items && payload.items.length > 0) {
          customData.content_ids = payload.items.map((i) => i.productId);
          customData.contents = payload.items.map((i) => ({
            id: i.productId,
            quantity: i.quantity,
            item_price: Number((i.itemPricePoisha / 100).toFixed(2)),
          }));
          customData.content_type = "product";
        }
        (window as any).fbq("track", payload.eventName, customData, { eventID: eventId });
      } catch {
        // Ignore extension blocker interference
      }
    }

    const ok = await send(payload);
    return {
      eventId,
      mode,
      outcome: ok ? "sent" : "failed",
      consent,
      anonymous: decision.mode === "anonymous",
      reason: decision.reason,
    };
  }

  return {
    mode,
    pixelIds: uniquePixelIds,
    track,
    pendingCount: () => queue.length,
    flushPending,
  };
}
