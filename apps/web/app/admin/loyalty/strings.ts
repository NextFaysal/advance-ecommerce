/**
 * Admin loyalty / referral / affiliate — UI dictionary (doc 30
 * unified language system). bn typed once, en typed as the mapped
 * type — parity is compile-checked. Member DATA (names, codes) is
 * never translated; tier labels come from the tier record's own
 * labelBn/labelEn fields, picked by locale at render.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "লয়্যালটি, রেফারেল ও অ্যাফিলিয়েট",
  description:
    "আসল ডেটা — পয়েন্ট লেজার (PointsLedgerEntry) থেকে হিসাব করা। পয়েন্ট লেজার append-only: ব্যালেন্স কখনো সরাসরি বদলানো যায় না।",
  errorDescription: "পয়েন্ট লেজার append-only: ব্যালেন্স কখনো সরাসরি বদলানো যায় না।",
  errorCard:
    "ডাটাবেস থেকে লয়্যালটি ডেটা পড়া যায়নি — তাই কোনো সংখ্যা দেখানো হচ্ছে না (আগের ডেমো সারি আর দেখানো হয় না)। ডাটাবেস সংযোগ ঠিক করে পেজটি আবার লোড করুন।",
  flagPrefix: "ফিচার ফ্ল্যাগ:",
  flagMiddle: "— বর্তমান অবস্থা (DB থেকে পড়া):",
  flagOn: "চালু (ON)",
  flagOff: "বন্ধ (OFF)",
  flagSuffix: "। ফ্ল্যাগ বদলাতে ফিচার ফ্ল্যাগ পেজে যান — প্রতিটি বদল কারণসহ অডিট লগে থাকে।",
  statMembers: "সদস্য",
  statReferrals: "রেফারেল",
  statAffiliates: "অ্যাফিলিয়েট পার্টনার",
  statPayable: "পরিশোধযোগ্য কমিশন",
  deltaRealLedger: "আসল লেজার",
  deltaRealData: "আসল ডেটা",
  deltaPayable: "PAYABLE অবস্থা",
  configTitle: "প্রোগ্রাম কনফিগ",
  configEarn: "আয়: প্রতি ১০০ পয়সা (৳১) খরচে {points} পয়েন্ট — শুধু DELIVERED অর্ডারে",
  configRedeem: "রিডিম: ১ পয়েন্ট = {value}; সাবটোটালের সর্বোচ্চ {pct}% পর্যন্ত",
  configExpiry: "পয়েন্টের মেয়াদ: {days} দিন",
  configReferral:
    "রেফারেল পুরস্কার: রেফারার {referrer} পয়েন্ট, নতুন গ্রাহক {referee} পয়েন্ট — প্রথম অর্ডার DELIVERED হলে",
  configAffiliate:
    "অ্যাফিলিয়েট: ডিফল্ট কমিশন {pct}%, কুকি উইন্ডো {cookieDays} দিন, কমিশন পরিশোধযোগ্য হয় ডেলিভারির {returnDays} দিন পর (রিটার্ন উইন্ডো — ফ্রড গার্ড)",
  membersCaption: "সদস্য — আসল লেজার থেকে",
  colBalance: "ব্যালেন্স (পয়েন্ট)",
  colLifetime: "মোট আয় (পয়েন্ট)",
  colTier: "টিয়ার",
  colRedeemValue: "রিডিম মূল্য",
  membersEmpty:
    "এখনো কোনো সদস্য নেই — কোনো অর্ডার DELIVERED হলেই ওই গ্রাহকের লেজারে পয়েন্ট জমা হয়ে তিনি এখানে দেখা যাবেন।",
  referralsCaption: "রেফারেল — আসল ডেটা",
  colCode: "কোড",
  colReferrer: "রেফারার",
  colReward: "পুরস্কার (রেফারার/নতুন)",
  colOrder: "যোগ্য অর্ডার",
  rewardPoints: "{a} / {b} পয়েন্ট",
  referralsEmpty: "এখনো কোনো রেফারেল তৈরি হয়নি।",
  affiliatesCaption: "অ্যাফিলিয়েট পেআউট — আসল ডেটা",
  colPartner: "পার্টনার",
  colCommission: "কমিশন",
  colPending: "অপেক্ষমাণ",
  colPayable: "পরিশোধযোগ্য",
  colPaid: "পরিশোধিত",
  affiliatesEmpty: "এখনো কোনো অ্যাফিলিয়েট পার্টনার নেই — পার্টনার যোগ হলে তাদের কমিশনের হিসাব এখানে আসবে।",
};

export type LoyaltyStrings = { [K in keyof typeof bn]: string };

const en: LoyaltyStrings = {
  title: "Loyalty, Referral & Affiliate",
  description:
    "Real data — computed from the points ledger (PointsLedgerEntry). The points ledger is append-only: a balance can never be edited directly.",
  errorDescription: "The points ledger is append-only: a balance can never be edited directly.",
  errorCard:
    "Loyalty data could not be read from the database — so no numbers are shown (the old demo rows are no longer shown). Fix the database connection and reload the page.",
  flagPrefix: "Feature flag:",
  flagMiddle: "— current state (read from DB):",
  flagOn: "On (ON)",
  flagOff: "Off (OFF)",
  flagSuffix: ". To change the flag, go to the Feature Flags page — every change is kept in the audit log with a reason.",
  statMembers: "Members",
  statReferrals: "Referrals",
  statAffiliates: "Affiliate partners",
  statPayable: "Payable commission",
  deltaRealLedger: "Real ledger",
  deltaRealData: "Real data",
  deltaPayable: "PAYABLE status",
  configTitle: "Program config",
  configEarn: "Earn: {points} points per 100 poisha (৳1) spent — on DELIVERED orders only",
  configRedeem: "Redeem: 1 point = {value}; up to {pct}% of the subtotal",
  configExpiry: "Points expiry: {days} days",
  configReferral:
    "Referral reward: referrer {referrer} points, new customer {referee} points — when the first order is DELIVERED",
  configAffiliate:
    "Affiliate: default commission {pct}%, cookie window {cookieDays} days, commission becomes payable {returnDays} days after delivery (return window — fraud guard)",
  membersCaption: "Members — from the real ledger",
  colBalance: "Balance (points)",
  colLifetime: "Lifetime earned (points)",
  colTier: "Tier",
  colRedeemValue: "Redeem value",
  membersEmpty:
    "No members yet — as soon as an order is DELIVERED, points land in that customer's ledger and they will appear here.",
  referralsCaption: "Referrals — real data",
  colCode: "Code",
  colReferrer: "Referrer",
  colReward: "Reward (referrer/new)",
  colOrder: "Qualifying order",
  rewardPoints: "{a} / {b} points",
  referralsEmpty: "No referrals have been created yet.",
  affiliatesCaption: "Affiliate payouts — real data",
  colPartner: "Partner",
  colCommission: "Commission",
  colPending: "Pending",
  colPayable: "Payable",
  colPaid: "Paid",
  affiliatesEmpty: "No affiliate partners yet — when partners are added, their commission accounts will appear here.",
};

export const LOYALTY_STRINGS: Record<Locale, LoyaltyStrings> = { bn, en };
