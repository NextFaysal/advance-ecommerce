/**
 * Admin subscriptions page — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * The list component itself (src/components/admin/subscriptions-list.tsx)
 * uses ADMIN_STRINGS subs* keys + src/subscriptions/labels by locale.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "সাবস্ক্রিপশন",
  breadcrumb: "অ্যাডমিন / সেলস",
  loginDescription: "কাস্টমার সাবস্ক্রিপশন ও অটো-রিপ্লেনিশ অর্ডার",
  description: "কাস্টমার সাবস্ক্রিপশন — কোনটি কখন অর্ডার তৈরি করবে, কোনটি ব্যর্থ হয়েছে",
  loginPrompt: "এই পেজ দেখতে আগে লগইন করুন।",
};

export type SubscriptionsAdminStrings = { [K in keyof typeof bn]: string };

const en: SubscriptionsAdminStrings = {
  title: "Subscriptions",
  breadcrumb: "Admin / Sales",
  loginDescription: "Customer subscriptions & auto-replenish orders",
  description: "Customer subscriptions — which will generate an order when, and which have failed",
  loginPrompt: "Log in first to view this page.",
};

export const SUBSCRIPTIONS_ADMIN_STRINGS: Record<Locale, SubscriptionsAdminStrings> = { bn, en };
