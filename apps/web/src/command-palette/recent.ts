/**
 * Recent searches — Agent 28. Browser-local only (localStorage), the
 * same defensive pattern as src/storefront-ux/recently-viewed: parsing
 * never throws, garbage in storage is treated as "no recents".
 *
 * Pure helpers (parseRecents / upsertRecent) are separated from the
 * storage wrappers so they are smoke-testable without a DOM.
 */
import { normalizeQueryText } from "./scoring";

export const RECENT_SEARCHES_KEY = "advance-ecommerce:recent-searches";
export const MAX_RECENT_SEARCHES = 8;

export function parseRecents(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === "string" && item.trim().length > 0) out.push(item.trim());
      if (out.length >= MAX_RECENT_SEARCHES) break;
    }
    return out;
  } catch {
    return [];
  }
}

/** Most-recent-first, de-duplicated (case/Bangla-digit-insensitive),
 *  capped at MAX_RECENT_SEARCHES. Empty queries are ignored. */
export function upsertRecent(list: readonly string[], query: string): string[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [...list];
  const needle = normalizeQueryText(trimmed);
  const rest = list.filter((item) => normalizeQueryText(item) !== needle);
  return [trimmed, ...rest].slice(0, MAX_RECENT_SEARCHES);
}

export function loadRecentSearches(): string[] {
  if (typeof window === "undefined") return [];
  try {
    return parseRecents(window.localStorage.getItem(RECENT_SEARCHES_KEY));
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string): string[] {
  const next = upsertRecent(loadRecentSearches(), query);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
    } catch {
      // Storage full/blocked — recents are a convenience, never an error.
    }
  }
  return next;
}

export function clearRecentSearches(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {
    // Ignore — see saveRecentSearch.
  }
}
