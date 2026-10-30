/**
 * Shared-UI primitive strings — doc 30 unified language system.
 *
 * The design-system primitives in this folder (modal, drawer, tabs,
 * select, filter-bar, breadcrumbs, skeleton, status badges, and the
 * shell's ThemeToggle / NumeralsToggle) are used by BOTH the admin
 * console and the storefront shell. They originally read the full
 * ADMIN_STRINGS dictionary (src/admin/strings.ts, ~44.5 KB) — and
 * because property access on one big const defeats tree-shaking, the
 * entire admin dictionary shipped to every storefront visitor.
 *
 * This module holds ONLY the keys the primitives actually read,
 * copied verbatim from src/admin/strings.ts (the admin console keeps
 * using ADMIN_STRINGS unchanged; if a shared label is ever edited,
 * edit both places). Shape follows the core contract: `bn` written
 * once (NOT `as const`), `en` typed with the mapped type so key
 * parity is compile-checked. Consumption is identical to before:
 * `const s = pick(locale, UI_STRINGS)`.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Chrome labels (modal / drawer / tabs / breadcrumbs / skeleton)
  close: "বন্ধ করুন",
  cancel: "বাতিল",
  confirm: "নিশ্চিত করুন",
  tabsLabel: "ট্যাব",
  breadcrumb: "ব্রেডক্রাম্ব",
  loading: "লোড হচ্ছে",

  // Select + filter bar
  comboboxPlaceholder: "খুঁজুন…",
  noResultsFound: "কোনো ফলাফল পাওয়া যায়নি।",
  clearSearch: "খোঁজ মুছুন",
  filterSearchLabel: "ফিল্টার খোঁজ",
  filterSearchPlaceholder: "অর্ডার, কাস্টমার, পণ্য খুঁজুন…",
  removeFilter: "ফিল্টার সরান {name}",

  // Shell toggles (theme + numeral script)
  darkMode: "ডার্ক মোড",
  bnNumerals: "বাংলা সংখ্যা",
  enNumerals: "ইংরেজি সংখ্যা",
  showBnNumerals: "বাংলা সংখ্যায় দেখান",
  showEnNumerals: "ইংরেজি সংখ্যায় দেখান",

  // Status badges (order / payment / risk)
  statusIncomplete: "অসম্পূর্ণ",
  statusPending: "মুলতুবি",
  statusConfirmed: "নিশ্চিত",
  statusProcessing: "প্রসেসিং",
  statusPacked: "প্যাক করা",
  statusShipped: "পাঠানো হয়েছে",
  statusDelivered: "ডেলিভারি হয়েছে",
  statusCancelled: "বাতিল",
  statusFailed: "ব্যর্থ",
  statusReturned: "ফেরত",
  statusRefunded: "রিফান্ড হয়েছে",
  payUnpaid: "অপরিশোধিত",
  payPartial: "আংশিক",
  payPaid: "পরিশোধিত",
  payFailed: "ব্যর্থ",
  payRefunded: "রিফান্ড হয়েছে",
  riskLow: "কম ঝুঁকি",
  riskMedium: "মাঝারি ঝুঁকি",
  riskHigh: "বেশি ঝুঁকি",
};

export type UiStrings = { [K in keyof typeof bn]: string };

const en: UiStrings = {
  close: "Close",
  cancel: "Cancel",
  confirm: "Confirm",
  tabsLabel: "Tabs",
  breadcrumb: "Breadcrumb",
  loading: "Loading",

  comboboxPlaceholder: "Search…",
  noResultsFound: "No results found.",
  clearSearch: "Clear search",
  filterSearchLabel: "Filter search",
  filterSearchPlaceholder: "Search orders, customers, products…",
  removeFilter: "Remove filter {name}",

  darkMode: "Dark mode",
  bnNumerals: "Bangla numerals",
  enNumerals: "English numerals",
  showBnNumerals: "Show in Bangla numerals",
  showEnNumerals: "Show in English numerals",

  statusIncomplete: "Incomplete",
    statusPending: "Pending",
  statusConfirmed: "Confirmed",
  statusProcessing: "Processing",
  statusPacked: "Packed",
  statusShipped: "Shipped",
  statusDelivered: "Delivered",
  statusCancelled: "Cancelled",
  statusFailed: "Failed",
  statusReturned: "Returned",
  statusRefunded: "Refunded",
  payUnpaid: "Unpaid",
  payPartial: "Partial",
  payPaid: "Paid",
  payFailed: "Failed",
  payRefunded: "Refunded",
  riskLow: "Low risk",
  riskMedium: "Medium risk",
  riskHigh: "High risk",
};

export const UI_STRINGS: Record<Locale, UiStrings> = { bn, en };
