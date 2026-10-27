/**
 * Admin newsletter subscribers — UI dictionary (doc 30 unified
 * language system). bn typed once, en typed as the mapped type —
 * parity is compile-checked. Subscriber DATA (emails, sources) is
 * never translated; only UI copy lives here.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "নিউজলেটার সাবস্ক্রাইবার",
  description:
    "স্টোরফ্রন্টের নিউজলেটার ফর্ম থেকে সংগ্রহ করা আসল সাবস্ক্রাইবার — ডাটাবেসের NewsletterSubscriber টেবিল থেকে। সর্বশেষ ২০০টি দেখানো হয়; মোট সংখ্যা আসল গণনা।",
  errorText: "ডাটাবেস থেকে সাবস্ক্রাইবার পড়া যায়নি — কোনো সংখ্যা দেখানো হচ্ছে না।",
  statTotal: "মোট সাবস্ক্রাইবার",
  statTotalDelta: "ডাটাবেসের আসল গণনা",
  statActive: "সক্রিয় (সাবস্ক্রাইব করা)",
  statActiveDelta: "এখনো সাবস্ক্রাইব করা আছেন",
  statUnsubscribed: "আনসাবস্ক্রাইব করেছেন",
  statUnsubscribedDelta: "সাবস্ক্রিপশন বাতিল করেছেন",
  emptyText:
    "এখনো কোনো সাবস্ক্রাইবার নেই। দর্শকরা স্টোরফ্রন্টের নিউজলেটার ফর্ম থেকে সাবস্ক্রাইব করলে তাঁদের ইমেইল এখানে দেখা যাবে।",
  caption: "সর্বশেষ সাবস্ক্রাইবার — নতুন থেকে পুরনো (সর্বোচ্চ ২০০টি)",
  colSource: "উৎস",
  colCreatedAt: "সাবস্ক্রাইবের সময়",
  colUnsubscribedAt: "আনসাবস্ক্রাইবের সময়",
  badgeSubscribed: "সাবস্ক্রাইব করা",
  badgeUnsubscribed: "আনসাবস্ক্রাইব",
};

export type NewsletterStrings = { [K in keyof typeof bn]: string };

const en: NewsletterStrings = {
  title: "Newsletter Subscribers",
  description:
    "Real subscribers collected from the storefront newsletter form — from the NewsletterSubscriber table in the database. The latest 200 are shown; totals are true counts.",
  errorText: "Subscribers could not be read from the database — no numbers are shown.",
  statTotal: "Total subscribers",
  statTotalDelta: "Actual count from the database",
  statActive: "Active (subscribed)",
  statActiveDelta: "Still subscribed",
  statUnsubscribed: "Unsubscribed",
  statUnsubscribedDelta: "Cancelled their subscription",
  emptyText:
    "No subscribers yet. When visitors subscribe from the storefront newsletter form, their emails will appear here.",
  caption: "Latest subscribers — newest first (max 200)",
  colSource: "Source",
  colCreatedAt: "Subscribed at",
  colUnsubscribedAt: "Unsubscribed at",
  badgeSubscribed: "Subscribed",
  badgeUnsubscribed: "Unsubscribed",
};

export const NEWSLETTER_STRINGS: Record<Locale, NewsletterStrings> = { bn, en };
