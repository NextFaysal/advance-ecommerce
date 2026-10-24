/**
 * Bengali numerals preference — pure helpers (no React, no DOM writes
 * beyond the two storage functions, which are window-guarded).
 *
 * The storefront renders money with Latin digits by default. A visitor
 * can opt into Bengali digits (০১২৩…) from the header toggle; the choice
 * persists in localStorage and is applied ONLY at display-formatting
 * level (see src/components/ui/numerals.tsx): stored values, API
 * payloads, form inputs, phone numbers and order numbers are never
 * converted — only the final formatted string a human reads.
 *
 * Storage conventions mirror src/catalog/wishlist.ts and
 * src/storefront-ux/compare.ts: an "advance-ecommerce:"-prefixed key
 * plus a same-tab change event (the `storage` event never fires in the
 * tab that wrote, so components subscribe to both).
 */

export type NumeralScript = "latn" | "bn";

export const NUMERALS_STORAGE_KEY = "advance-ecommerce:numerals";
export const NUMERALS_CHANGE_EVENT = "advance-ecommerce:numerals-changed";

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"] as const;

/**
 * Convert every Latin digit in a DISPLAY string to its Bengali digit.
 * Non-digit characters (৳, commas, decimal points, minus signs, Latin
 * letters) pass through untouched, so it is safe to run over a fully
 * formatted money string like "৳1,234.50" → "৳১,২৩৪.৫০".
 */
export function toBengaliDigits(text: string): string {
  return text.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] as string);
}

/** Stored preference; "latn" (Latin) when unset or unreadable. */
export function getNumeralScript(): NumeralScript {
  if (typeof window === "undefined") return "latn";
  try {
    return window.localStorage.getItem(NUMERALS_STORAGE_KEY) === "bn" ? "bn" : "latn";
  } catch {
    return "latn";
  }
}

/** Persist the preference and notify mounted components in this tab. */
export function setNumeralScript(script: NumeralScript): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NUMERALS_STORAGE_KEY, script);
  } catch {
    // Storage unavailable (private mode etc.) — the change event below
    // still applies the choice for this session/tab.
  }
  window.dispatchEvent(new Event(NUMERALS_CHANGE_EVENT));
}
