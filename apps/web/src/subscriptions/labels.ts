/**
 * Subscription shared constants (ADV-18 remainder) — PURE module:
 * no Prisma, no server imports, safe for client components. The
 * service (src/subscriptions/service.ts) re-exports these so server
 * consumers have one import home.
 */

export const SUBSCRIPTION_INTERVALS = ["WEEKLY", "BIWEEKLY", "MONTHLY"] as const;
export type SubscriptionInterval = (typeof SUBSCRIPTION_INTERVALS)[number];

export const SUBSCRIPTION_STATUSES = ["ACTIVE", "PAUSED", "CANCELLED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INTERVAL_LABELS: Record<SubscriptionInterval, { bn: string; en: string }> = {
  WEEKLY: { bn: "প্রতি সপ্তাহে", en: "Every week" },
  BIWEEKLY: { bn: "প্রতি ২ সপ্তাহে", en: "Every 2 weeks" },
  MONTHLY: { bn: "প্রতি মাসে", en: "Every month" },
};

export const STATUS_LABELS: Record<string, { bn: string; en: string }> = {
  ACTIVE: { bn: "সক্রিয়", en: "Active" },
  PAUSED: { bn: "থামানো", en: "Paused" },
  CANCELLED: { bn: "বাতিল", en: "Cancelled" },
};

/** 1000 bps -> "10", 250 bps -> "2.5" (display only). */
export function formatBpsPercent(bps: number): string {
  return (bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** ISO timestamp -> a short Bangla date ("২৬ অক্টোবর ২০২৬"). */
export function formatSubscriptionDate(iso: string | null): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("bn-BD", { day: "numeric", month: "long", year: "numeric" });
}
