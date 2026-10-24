// Tracking consent — Agent 24.
// Rules:
//  - "granted": events flow with hashed user data.
//  - "denied": events are DROPPED, except strictly-necessary ones (an event
//    the caller explicitly marks strictlyNecessary — standard marketing
//    events never are). Dropped events are counted, never queued for later.
//  - "unknown" (no banner answer yet): the event may be recorded in
//    anonymous mode only — NO user identifiers are processed at all (not
//    even hashed), so nothing personal leaves the server.
export type TrackingConsentState = "granted" | "denied" | "unknown";

export const CONSENT_STATES: readonly TrackingConsentState[] = ["granted", "denied", "unknown"];

export interface ConsentDecision {
  allowed: boolean;
  /** "full" = hashed user data allowed; "anonymous" = event only, no user data. */
  mode: "full" | "anonymous" | "dropped";
  reason: string;
}

export function evaluateTrackingConsent(
  consent: TrackingConsentState,
  event: { strictlyNecessary?: boolean },
): ConsentDecision {
  if (consent === "granted") return { allowed: true, mode: "full", reason: "consent_granted" };
  if (consent === "denied") {
    if (event.strictlyNecessary === true) {
      return { allowed: true, mode: "anonymous", reason: "strictly_necessary" };
    }
    return { allowed: false, mode: "dropped", reason: "consent_denied" };
  }
  // unknown
  if (event.strictlyNecessary === true) {
    return { allowed: true, mode: "anonymous", reason: "strictly_necessary" };
  }
  return { allowed: true, mode: "anonymous", reason: "consent_unknown_anonymous_only" };
}
