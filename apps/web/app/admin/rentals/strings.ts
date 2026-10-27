/**
 * Admin rentals — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Rental DATA (product names from the DB) is never translated; rental
 * status labels come from src/rental/selection (BN/EN pair).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page
  title: "ভাড়া",
  description:
    "চলমান ভাড়ার বোর্ড — ফেরতের তারিখ অনুযায়ী সাজানো। মেয়াদ পেরিয়ে গেলে ভাড়া নিজে থেকেই ‘মেয়াদোত্তীর্ণ’ দেখায় (আলাদা cron নেই)। বোর্ডটি প্রতি ৩০ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)। ফেরত নিলে জামানত গ্রাহককে ম্যানুয়ালি ফেরত দিন — সিস্টেম নিজে থেকে টাকা ফেরত দেয় না।",
  lockedPrefix: "🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। ভাড়া একটি পেইড অ্যাড-অন — আনলক করতে",
  lockedSuffix: "Admin > Settings > Feature Flags থেকে চালু করুন।",

  // Board
  boardAria: "ভাড়ার বোর্ড",
  boardLoadFailed: "ভাড়ার বোর্ড লোড করা যায়নি।",
  boardLoadNetwork: "নেটওয়ার্ক ত্রুটি — বোর্ড হালনাগাদ করা যায়নি।",
  updateFailed: "ভাড়া হালনাগাদ করা যায়নি।",
  updateNetwork: "নেটওয়ার্ক ত্রুটি — ভাড়া হালনাগাদ করা যায়নি।",
  boardLoading: "ভাড়ার বোর্ড লোড হচ্ছে…",
  emptyBoard: "এখন কোনো চলমান ভাড়া নেই।",
  activeLabel: "চলমান:",
  overdueLabel: "মেয়াদোত্তীর্ণ:",
  returnedLabel: "ফেরত:",
  cancelledLabel: "বাতিল:",
  count: "{count}টি",
  lateFeePrefix: "চুক্তির বিলম্ব ফি: দিনপ্রতি",
  lateFeeSuffix: "(ম্যানুয়ালি হিসাব হয় — নিজে থেকে কাটা হয় না)",
  pollNote: "প্রতি ৩০ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।",
  daysRemaining: "আর {days} দিন বাকি",
  dueToday: "আজই ফেরতের দিন",
  daysOverdue: "{days} দিন মেয়াদোত্তীর্ণ",
  orderWord: "অর্ডার",
  rentalPeriod: "ভাড়া: {start} → {end} ({days} দিন)",
  depositPrefix: "জামানত:",
  depositSuffix: "(ফেরতে ম্যানুয়ালি ফেরত দিন)",
  returnedBtn: "ফেরত এসেছে",
  markOverdueBtn: "মেয়াদোত্তীর্ণ চিহ্নিত করুন",

  // Config card
  configAria: "ভাড়া কনফিগ",
  configTitle: "ভাড়া কনফিগ",
  configIntro:
    "কোন ভ্যারিয়েন্ট ভাড়া দেওয়া যাবে, সর্বোচ্চ কত দিন, আর জামানতের নিয়ম — সব এখান থেকে। জামানত বদলালে শুধু নতুন অর্ডারে প্রযোজ্য হয়; চলমান ভাড়ার জামানত অর্ডারের সময়েই নির্ধারিত (frozen) থাকে।",
  sourceLabel: "উৎস:",
  sourceSaved: "সংরক্ষিত",
  sourceDefault: "ডিফল্ট",
  moduleOffNote: "মডিউল এখন বন্ধ (module.rental) — কনফিগ আগে থেকে তৈরি রাখা যায়।",
  configLoadFailed: "কনফিগ লোড করা যায়নি।",
  configLoadNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।",
  configSaveFailed: "কনফিগ সংরক্ষণ করা যায়নি।",
  configSaveNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।",
  configSaved: "কনফিগ সংরক্ষিত হয়েছে।",
  reasonRequired: "পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।",
  amountsInvalid: "টাকার পরিমাণগুলো সঠিক সংখ্যা হতে হবে (ঋণাত্মক নয়)।",
  percentInvalid: "জামানতের শতকরা হার ০–১০০-এর মধ্যে হতে হবে।",
  maxRentalDays: "সর্বোচ্চ ভাড়ার মেয়াদ (দিন)",
  depositType: "জামানতের ধরন",
  depositNone: "জামানত নেই",
  depositFixed: "নির্দিষ্ট পরিমাণ (প্রতি ভাড়ায়)",
  depositPercent: "পণ্যের দামের শতকরা অংশ",
  depositAmount: "জামানতের পরিমাণ (টাকা)",
  depositRate: "জামানতের হার (দামের %)",
  lateFeeLabel: "বিলম্ব ফি (টাকা / দিন)",
  lateFeeHelp: "শুধু চুক্তির হার — সিস্টেম নিজে থেকে এই ফি কাটে না; মেয়াদোত্তীর্ণ ফেরতে ম্যানুয়ালি হিসাব করুন।",
  variantIdsLabel: "ভাড়াযোগ্য ভ্যারিয়েন্ট ID (প্রতি লাইনে একটি)",
  variantIdsHelp:
    "তালিকার বাইরের কোনো ভ্যারিয়েন্ট ভাড়া দেওয়া হবে না। প্রতিটি ভ্যারিয়েন্টের stock-ই তার মোট ইউনিট সংখ্যা — ভাড়া চলাকালীন stock কমে না, তারিখের ওভারল্যাপ দিয়েই প্রাপ্যতা হিসাব হয়। ভ্যারিয়েন্ট ID পণ্যের সম্পাদনা পেজে পাওয়া যায়।",
  reasonLabel: "পরিবর্তনের কারণ (আবশ্যক)",
  reasonPlaceholder: "যেমন: নতুন ভাড়ার পণ্য যোগ করা হলো",
  saving: "সংরক্ষণ হচ্ছে…",
  saveConfig: "কনফিগ সংরক্ষণ করুন",
};

export type RentalsStrings = { [K in keyof typeof bn]: string };

const en: RentalsStrings = {
  title: "Rentals",
  description:
    "The board of live rentals — sorted by return date. Past its period, a rental shows as ‘Overdue’ by itself (there is no separate cron). The board refreshes itself every 30 seconds (polling — not live realtime). On return, refund the deposit to the customer manually — the system never refunds money by itself.",
  lockedPrefix: "🔒 This module is locked for this install. Rental is a paid add-on — enable",
  lockedSuffix: "in Admin > Settings > Feature Flags to unlock it.",

  boardAria: "Rentals board",
  boardLoadFailed: "Could not load the rentals board.",
  boardLoadNetwork: "Network error — could not refresh the board.",
  updateFailed: "Could not update the rental.",
  updateNetwork: "Network error — could not update the rental.",
  boardLoading: "Loading the rentals board…",
  emptyBoard: "No live rentals right now.",
  activeLabel: "Active:",
  overdueLabel: "Overdue:",
  returnedLabel: "Returned:",
  cancelledLabel: "Cancelled:",
  count: "{count}",
  lateFeePrefix: "Contractual late fee: per day",
  lateFeeSuffix: "(calculated manually — never charged automatically)",
  pollNote: "Auto-refreshes every 30 seconds (polling — not live realtime).",
  daysRemaining: "{days} days left",
  dueToday: "Due back today",
  daysOverdue: "{days} days overdue",
  orderWord: "Order",
  rentalPeriod: "Rental: {start} → {end} ({days} days)",
  depositPrefix: "Deposit:",
  depositSuffix: "(refund manually on return)",
  returnedBtn: "Returned",
  markOverdueBtn: "Mark overdue",

  configAria: "Rental config",
  configTitle: "Rental Config",
  configIntro:
    "Which variants can be rented, the maximum number of days, and the deposit rules — all from here. Changing the deposit applies only to new orders; a live rental's deposit stays as fixed (frozen) at order time.",
  sourceLabel: "Source:",
  sourceSaved: "Saved",
  sourceDefault: "Default",
  moduleOffNote: "The module is currently off (module.rental) — the config can be prepared in advance.",
  configLoadFailed: "Could not load the config.",
  configLoadNetwork: "Network error — could not load the config.",
  configSaveFailed: "Could not save the config.",
  configSaveNetwork: "Network error — could not save the config.",
  configSaved: "Config saved.",
  reasonRequired: "Enter a reason for the change (required for the audit log).",
  amountsInvalid: "The taka amounts must be valid numbers (not negative).",
  percentInvalid: "The deposit percentage must be between 0–100.",
  maxRentalDays: "Maximum rental period (days)",
  depositType: "Deposit type",
  depositNone: "No deposit",
  depositFixed: "Fixed amount (per rental)",
  depositPercent: "Percentage of the product price",
  depositAmount: "Deposit amount (taka)",
  depositRate: "Deposit rate (% of price)",
  lateFeeLabel: "Late fee (taka / day)",
  lateFeeHelp: "The contractual rate only — the system never charges this fee itself; calculate it manually for overdue returns.",
  variantIdsLabel: "Rentable variant IDs (one per line)",
  variantIdsHelp:
    "No variant outside this list will be rented. Each variant's stock is its total unit count — stock does not decrease during a rental; availability is calculated from date overlaps. Variant IDs are found on the product edit page.",
  reasonLabel: "Reason for the change (required)",
  reasonPlaceholder: "e.g. Added a new rental product",
  saving: "Saving…",
  saveConfig: "Save config",
};

export const RENTALS_STRINGS: Record<Locale, RentalsStrings> = { bn, en };
