/**
 * Unified language system (doc 30) — SEARCH page-state dictionary
 * (wave P5, doc 32).
 *
 * Only the designed state copy that STORE_STRINGS does not carry
 * lives here (idle / no-results / error titles + descriptions for
 * the kit EmptyState); the page's sentence-level copy (idle hint,
 * result headings, engine line) still comes from STORE_STRINGS.
 * Shape follows the doc-30 contract: a `bn` object typed once, `en`
 * typed as the mapped SearchStrings — a missing/extra key in either
 * locale fails compilation, so the two can never drift.
 *
 * Usage: `pick(locale, SEARCH_STRINGS)` with locale from
 * useLocale() (the search page is a client surface).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  idleTitle: "কী খুঁজছেন?",
  noResultsTitle: "কিছু পাওয়া যায়নি",
  noResultsDescription: "“{q}” দিয়ে কোনো পণ্য মেলেনি। বানান দেখে আবার চেষ্টা করুন, অথবা সব পণ্য থেকে খুঁজে নিন।",
  errorTitle: "খুঁজতে সমস্যা হয়েছে",
  errorDescription: "একটু পরে আবার চেষ্টা করুন, অথবা সব পণ্য দেখে নিন।",
};

export type SearchStrings = { [K in keyof typeof bn]: string };

const en: SearchStrings = {
  idleTitle: "What are you looking for?",
  noResultsTitle: "No results found",
  noResultsDescription: "No products matched “{q}”. Check the spelling and try again, or browse all products instead.",
  errorTitle: "Something went wrong",
  errorDescription: "Please try again shortly, or browse all products instead.",
};

export const SEARCH_STRINGS: Record<Locale, SearchStrings> = { bn, en };
