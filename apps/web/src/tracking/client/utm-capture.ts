// UTM capture — Agent 26 (storefront tracking client).
// Persists the Agent 24 attribution shapes (../attribution.ts) in
// localStorage: first-touch is set once and never overwritten, last-touch
// refreshes on every UTM-carrying visit, and a direct visit (no UTM)
// changes nothing. The pure rules come from captureTouch()/parseUtmFromUrl()
// — this file is only the browser storage seam around them.
import {
  EMPTY_TOUCHES,
  captureTouch,
  hasAnyUtm,
  parseUtmFromUrl,
  type AttributionTouches,
  type TouchPoint,
  type UtmParams,
} from "../attribution";

export const TOUCHES_STORAGE_KEY = "advance-ecommerce:attribution-touches";

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTouchPoint(value: unknown): value is TouchPoint {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    isNullableString(t.utmSource) &&
    isNullableString(t.utmMedium) &&
    isNullableString(t.utmCampaign) &&
    isNullableString(t.utmTerm) &&
    isNullableString(t.utmContent) &&
    isNullableString(t.landingUrl) &&
    typeof t.capturedAt === "string"
  );
}

/** Reads stored touches; anything malformed falls back to EMPTY_TOUCHES. */
export function readStoredTouches(): AttributionTouches {
  if (typeof window === "undefined") return { ...EMPTY_TOUCHES };
  try {
    const raw = window.localStorage.getItem(TOUCHES_STORAGE_KEY);
    if (!raw) return { ...EMPTY_TOUCHES };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_TOUCHES };
    const first = (parsed as { firstTouch?: unknown }).firstTouch ?? null;
    const last = (parsed as { lastTouch?: unknown }).lastTouch ?? null;
    return {
      firstTouch: isTouchPoint(first) ? first : null,
      lastTouch: isTouchPoint(last) ? last : null,
    };
  } catch {
    return { ...EMPTY_TOUCHES };
  }
}

function persistTouches(touches: AttributionTouches): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOUCHES_STORAGE_KEY, JSON.stringify(touches));
  } catch {
    // Attribution is best-effort; a blocked store must not break the page.
  }
}

/**
 * Captures UTM params from a landing URL (defaults to the current page).
 * Pass `url` explicitly in tests or when the router supplies it. Visits
 * without UTM params leave storage untouched. Returns the stored touches.
 */
export function captureUtmFromUrl(url?: string): AttributionTouches {
  const target = url ?? (typeof window !== "undefined" ? window.location.href : "");
  if (!target) return readStoredTouches();
  const utm = parseUtmFromUrl(target);
  const current = readStoredTouches();
  if (!hasAnyUtm(utm)) return current;
  const next = captureTouch(current, utm, target, new Date().toISOString());
  persistTouches(next);
  return next;
}

/** UTM params of the last touch, for attaching to outgoing events. */
export function getLastTouchUtm(): UtmParams | null {
  const { lastTouch } = readStoredTouches();
  if (!lastTouch) return null;
  return {
    utmSource: lastTouch.utmSource,
    utmMedium: lastTouch.utmMedium,
    utmCampaign: lastTouch.utmCampaign,
    utmTerm: lastTouch.utmTerm,
    utmContent: lastTouch.utmContent,
  };
}
