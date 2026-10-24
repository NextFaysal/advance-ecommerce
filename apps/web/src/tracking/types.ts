// Server-side tracking + attribution — Agent 24 (Part H / A8).
// PII rule for the whole module: plain phone/email may ENTER a builder as
// input, but only SHA-256 hashes ever leave one. Nothing in this module logs
// a plain phone, email, or any access token. Money stays integer poisha
// internally; the single poisha -> decimal-BDT conversion lives in capi.ts
// (and the GA4/TikTok builders reuse it) because the external APIs require
// decimal major units — that conversion happens at the payload edge only.
import type { TrackingEvent, TrackingEventName } from "../marketing/tracking";

export type { TrackingEvent, TrackingEventName };

/** Standard event catalogue for pixel + CAPI. Extends the Agent 5 outline. */
export type StandardEventName =
  | "PageView"
  | "ViewContent"
  | "AddToCart"
  | "InitiateCheckout"
  | "Purchase"
  | "Lead"
  | "CompleteRegistration";

export const STANDARD_EVENT_NAMES: readonly StandardEventName[] = [
  "PageView",
  "ViewContent",
  "AddToCart",
  "InitiateCheckout",
  "Purchase",
  "Lead",
  "CompleteRegistration",
] as const;

/** Maps a standard event to the Agent 5 marketing outline name (if any). */
export const STANDARD_TO_MARKETING_EVENT: Record<StandardEventName, TrackingEventName | null> = {
  PageView: null,
  ViewContent: "view_content",
  AddToCart: "add_to_cart",
  InitiateCheckout: "checkout",
  Purchase: "purchase",
  Lead: null,
  CompleteRegistration: null,
};

export interface TrackingContentItem {
  productId: string;
  variantId: string | null;
  quantity: number;
  /** Unit price, integer poisha. */
  itemPricePoisha: number;
}

/** Plain user identifiers — internal input only, hashed before any payload. */
export interface TrackingUserInput {
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface TrackingEventInput {
  eventName: StandardEventName;
  /**
   * Shared eventId for browser pixel + server CAPI dedup. Callers that fire
   * the browser pixel MUST pass the same id here; when omitted one is
   * generated (server-only event, nothing to dedupe against).
   */
  eventId?: string;
  orderId?: string | null;
  /** Integer poisha. Required for Purchase; optional for commerce events. */
  valuePoisha?: number | null;
  items?: TrackingContentItem[];
  user?: TrackingUserInput;
  eventSourceUrl?: string | null;
  occurredAt?: string;
  /**
   * Strictly-necessary events (e.g. an order-confirmation record the shop is
   * legally required to keep) may still be recorded when consent is denied.
   * Standard marketing events are never strictly necessary (default false).
   */
  strictlyNecessary?: boolean;
}

/** A built event: the Agent 5 dedup record plus the standard-event detail. */
export interface BuiltTrackingEvent {
  dedup: TrackingEvent;
  eventName: StandardEventName;
  items: TrackingContentItem[];
  eventSourceUrl: string | null;
  strictlyNecessary: boolean;
}
