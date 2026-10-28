/**
 * Unified language system (doc 30) — RECENTLY VIEWED dictionary
 * (wave P5, doc 32).
 *
 * This page previously rendered hardcoded Bangla in every locale;
 * its copy now lives here as bn+en pairs, following the doc-30
 * contract: a `bn` object typed once, `en` typed as the mapped
 * RecentlyViewedStrings — a missing/extra key in either locale
 * fails compilation, so the two can never drift. The Bangla values
 * preserve the page's original wording as the bn half.
 *
 * Usage: `pick(locale, RECENTLY_VIEWED_STRINGS)` with locale from
 * useLocale() (the page is a client surface).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  heading: "সম্প্রতি দেখেছেন",
  note: "এই তালিকা শুধু এই ব্রাউজারেই থাকে — অ্যাকাউন্টে সংরক্ষিত হয় না।",
  clearHistory: "ইতিহাস মুছুন",
  emptyTitle: "এখনো কিছু দেখেননি",
  emptyDescription: "পণ্যের পেজে গেলেই সেগুলো এখানে জমা হবে।",
  startShopping: "কেনাকাটা শুরু করুন",
  priceFrom: "{price} থেকে",
};

export type RecentlyViewedStrings = { [K in keyof typeof bn]: string };

const en: RecentlyViewedStrings = {
  heading: "Recently viewed",
  note: "This list lives only in this browser — it is not saved to your account.",
  clearHistory: "Clear history",
  emptyTitle: "Nothing viewed yet",
  emptyDescription: "Products you open will collect here.",
  startShopping: "Start shopping",
  priceFrom: "From {price}",
};

export const RECENTLY_VIEWED_STRINGS: Record<Locale, RecentlyViewedStrings> = { bn, en };
