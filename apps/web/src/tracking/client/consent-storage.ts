// Consent storage — Agent 26 (storefront tracking client).
// The consent CHOICE lives in localStorage; the vocabulary and the rules
// live in ../consent.ts (Agent 24) and are imported, never redefined.
// Stored states are only "granted" | "denied" — "unknown" is represented
// by the ABSENCE of a record, so clearing storage resets the banner.
// This module holds no identifiers and no event data — just the choice.
import type { TrackingConsentState } from "../consent";

export const CONSENT_STORAGE_KEY = "advance-ecommerce:tracking-consent";

/** States that can be stored. "unknown" is never stored (see header). */
export type StoredConsentState = Exclude<TrackingConsentState, "unknown">;

export interface ConsentRecord {
  state: StoredConsentState;
  /** ISO timestamp of the decision. */
  decidedAt: string;
}

type ConsentListener = (state: TrackingConsentState) => void;

const listeners = new Set<ConsentListener>();

function notify(state: TrackingConsentState): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(state);
    } catch {
      // A broken listener must never break consent handling.
    }
  }
}

function isStoredState(value: unknown): value is StoredConsentState {
  return value === "granted" || value === "denied";
}

/** Reads the stored record, or null when no (valid) choice exists. */
export function readConsentRecord(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const state = (parsed as { state?: unknown }).state;
    const decidedAt = (parsed as { decidedAt?: unknown }).decidedAt;
    if (!isStoredState(state) || typeof decidedAt !== "string") return null;
    return { state, decidedAt };
  } catch {
    return null;
  }
}

/** Current consent state: the stored choice, or "unknown" when undecided. */
export function readConsentState(): TrackingConsentState {
  return readConsentRecord()?.state ?? "unknown";
}

/**
 * Persists a decision and notifies subscribers (same-tab listeners plus
 * the native "storage" event covers other tabs). Returns the record.
 */
export function writeConsentState(state: StoredConsentState): ConsentRecord {
  const record: ConsentRecord = { state, decidedAt: new Date().toISOString() };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // Storage full/blocked: the decision still applies for this page
      // view via the listener notification below.
    }
  }
  notify(state);
  return record;
}

/** Removes the stored choice (back to "unknown") and notifies. */
export function clearConsentState(): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  }
  notify("unknown");
}

/**
 * Subscribes to consent changes — both same-tab writes (writeConsentState)
 * and cross-tab changes (window "storage" event). Returns an unsubscribe
 * function. Safe to call during SSR (no-op subscription).
 */
export function subscribeConsent(listener: ConsentListener): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => {
      listeners.delete(listener);
    };
  }
  const onStorage = (event: StorageEvent): void => {
    if (event.key === CONSENT_STORAGE_KEY) listener(readConsentState());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}
