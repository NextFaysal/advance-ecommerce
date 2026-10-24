// Pixel + server-side CAPI tracking outline — Agent 5, Step 26 (types only).
// Deduplication rule: browser pixel event and server CAPI event for the same action
// share one eventId. The receiver must dedupe on eventId; sending both without a
// shared eventId double-counts. No pixel IDs or tokens live in this file.

export type TrackingEventName = "purchase" | "add_to_cart" | "checkout" | "view_content";

export interface TrackingEvent {
  /** Shared by pixel + CAPI for the same action. Required for deduplication. */
  eventId: string;
  eventName: TrackingEventName;
  orderId: string | null;
  /** Integer poisha for purchase events, null otherwise. */
  valuePoisha: number | null;
  currency: "BDT";
  source: "browser" | "server";
  occurredAt: string;
}

export interface DeduplicationResult {
  eventId: string;
  accepted: boolean;
  duplicateOf: string | null;
}
