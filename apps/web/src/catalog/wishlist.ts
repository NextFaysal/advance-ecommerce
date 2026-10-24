// Wishlist stub — Step 11.
// Until customer auth (Step 13) lands, wishlist is local-only (localStorage).
// After Step 13 it must move to a server wishlist table (see SCHEMA-ADDITIONS.md)
// keyed by customerId, with this same productId list API.

const STORAGE_KEY = "advance-ecommerce:wishlist";

/**
 * Same-tab change notification (the `storage` event never fires in the
 * tab that wrote). Mirrors the compare module's CHANGE_EVENT pattern:
 * the header badge and any mounted toggle buttons subscribe to this so
 * a toggle anywhere updates everywhere in the tab instantly.
 */
export const WISHLIST_CHANGE_EVENT = "advance-ecommerce:wishlist-changed";

export function getWishlistIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function toggleWishlistId(productId: string): string[] {
  const current = getWishlistIds();
  const next = current.includes(productId)
    ? current.filter((id) => id !== productId)
    : [...current, productId];
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event(WISHLIST_CHANGE_EVENT));
  }
  return next;
}
