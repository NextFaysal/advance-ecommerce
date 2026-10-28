// Event builder + deduplication — Agent 24.
// Dedup contract (from Agent 5, src/marketing/tracking.ts): the browser pixel
// event and the server CAPI event for the same action MUST share one
// eventId; receivers dedupe on it. generateEventId() is isomorphic (browser
// + server) so the storefront can mint the id, fire the pixel with it, and
// pass the same id to the server — neither side invents its own.
import type { DeduplicationResult } from "../marketing/tracking";
import {
  STANDARD_TO_MARKETING_EVENT,
  type BuiltTrackingEvent,
  type TrackingEventInput,
} from "./types";

export function generateEventId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for very old runtimes: time + random, still unique enough for dedup.
  return `evt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e12).toString(36)}`;
}

export function buildTrackingEvent(input: TrackingEventInput): BuiltTrackingEvent {
  const eventId = input.eventId ?? generateEventId();
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  const marketingName = STANDARD_TO_MARKETING_EVENT[input.eventName];
  return {
    dedup: {
      eventId,
      // Agent 5 outline has no name for PageView/Lead/Registration; those are
      // recorded against the closest commerce name only when one exists.
      eventName: marketingName ?? "view_content",
      orderId: input.orderId ?? null,
      valuePoisha: input.valuePoisha ?? null,
      currency: "BDT",
      source: "server",
      occurredAt,
    },
    eventName: input.eventName,
    items: input.items ?? [],
    eventSourceUrl: input.eventSourceUrl ?? null,
    strictlyNecessary: input.strictlyNecessary ?? false,
  };
}

/**
 * In-memory dedup store (local/demo). Production: a Redis SETNX or a DB
 * unique index on eventId with the same contract — first sighting accepted,
 * every replay returns duplicateOf = the eventId itself.
 */
export interface DedupStore {
  check(eventId: string): DeduplicationResult;
  size(): number;
}

export function createInMemoryDedupStore(): DedupStore {
  const seen = new Set<string>();
  return {
    check(eventId: string): DeduplicationResult {
      if (seen.has(eventId)) return { eventId, accepted: false, duplicateOf: eventId };
      seen.add(eventId);
      return { eventId, accepted: true, duplicateOf: null };
    },
    size(): number {
      return seen.size;
    },
  };
}

/** Shared demo instance for the public track-events route. */
export const demoDedupStore: DedupStore = createInMemoryDedupStore();
