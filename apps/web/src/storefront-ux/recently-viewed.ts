/**
 * Recently viewed products — Part B. Browser-local only (localStorage),
 * same pattern as src/catalog/wishlist.ts: no account, no server call.
 * Pure list logic is separated from the window wrapper so it is testable.
 *
 * Test cases:
 *  upsert([], A) -> [A]; upsert([A,B], A') -> [A',B] (dedupe + most recent first)
 *  upsert with cap 20 on a 20-item list drops the OLDEST entry, never the new one.
 */
import type { RecentlyViewedEntry } from "./types";

const STORAGE_KEY = "advance-ecommerce:recently-viewed";
export const RECENTLY_VIEWED_CAP = 20;

export function upsertRecentlyViewed(
  list: RecentlyViewedEntry[],
  entry: RecentlyViewedEntry,
  cap: number = RECENTLY_VIEWED_CAP,
): RecentlyViewedEntry[] {
  const rest = list.filter((e) => e.productId !== entry.productId);
  return [entry, ...rest].slice(0, Math.max(1, cap));
}

export function parseRecentlyViewed(raw: string | null): RecentlyViewedEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentlyViewedEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentlyViewedEntry).productId === "string" &&
        typeof (e as RecentlyViewedEntry).slug === "string" &&
        typeof (e as RecentlyViewedEntry).pricePoisha === "number",
    );
  } catch {
    return [];
  }
}

export function getRecentlyViewed(): RecentlyViewedEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecentlyViewed(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

export function recordRecentlyViewed(entry: RecentlyViewedEntry): RecentlyViewedEntry[] {
  const next = upsertRecentlyViewed(getRecentlyViewed(), entry);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage full/blocked — recently-viewed is a nicety, never an error.
    }
  }
  return next;
}

export function clearRecentlyViewed(): void {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(STORAGE_KEY);
  }
}
