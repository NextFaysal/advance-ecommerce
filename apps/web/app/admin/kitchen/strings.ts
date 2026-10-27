/**
 * Admin kitchen (KDS) — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Ticket DATA (product names from the DB) is never translated; ticket
 * status labels come from src/restaurant/selection (BN/EN pair).
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page
  title: "কিচেন (KDS)",
  description:
    "রেস্টুরেন্ট অর্ডারের রান্নাঘরের কিউ — অপেক্ষমাণ → তৈরি হচ্ছে → প্রস্তুত → পরিবেশন। বোর্ডটি প্রতি ১৫ সেকেন্ডে নিজে হালনাগাদ হয় (polling — live realtime নয়)। অর্ডার বাতিল হলে তার টিকিটও নিজে থেকে বাতিল হয়ে যায়।",
  lockedPrefix: "🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। রেস্টুরেন্ট + কিচেন ডিসপ্লে একটি পেইড অ্যাড-অন — আনলক করতে",
  lockedSuffix: "Admin > Settings > Feature Flags থেকে চালু করুন।",

  // Board
  boardAria: "কিচেন বোর্ড",
  boardLoadFailed: "কিচেন বোর্ড লোড করা যায়নি।",
  boardLoadNetwork: "নেটওয়ার্ক ত্রুটি — বোর্ড হালনাগাদ করা যায়নি।",
  advanceFailed: "টিকিট এগিয়ে নেওয়া যায়নি।",
  advanceNetwork: "নেটওয়ার্ক ত্রুটি — টিকিট হালনাগাদ করা যায়নি।",
  boardLoading: "কিচেন বোর্ড লোড হচ্ছে…",
  servedTodayLabel: "আজ পরিবেশিত:",
  cancelledTodayLabel: "আজ বাতিল:",
  count: "{count}টি",
  pollNote: "প্রতি ১৫ সেকেন্ডে স্বয়ংক্রিয় হালনাগাদ হয় (polling — live realtime নয়)।",
  noTickets: "কোনো টিকিট নেই।",
  tableLabel: "টেবিল: {label}",
  takeaway: "টেকঅওয়ে",
  waiting: "{mins} মিনিট ধরে অপেক্ষমাণ",
  advanceStart: "তৈরি শুরু করুন",
  advanceReady: "প্রস্তুত করুন",
  advanceServed: "পরিবেশন হয়েছে",

  // Config card
  configAria: "রেস্টুরেন্ট কনফিগ",
  configTitle: "রেস্টুরেন্ট সেটিংস",
  configIntroA: "টেবিলের তালিকা আর ডাইন-ইন / টেকঅওয়ে চালু-বন্ধ — Setting ডকুমেন্ট",
  configIntroDefaultSuffix: "(এখনো কিছু সংরক্ষিত হয়নি — কোডের ডিফল্ট চলছে)",
  configIntroB: "টেবিল একটিও না থাকলে ডাইন-ইন কার্যত বন্ধ থাকে, টগল যাই হোক।",
  effectiveLine: "বর্তমানে কার্যকর: ডাইন-ইন {dineIn}, টেকঅওয়ে {takeaway}।",
  stateOn: "চালু",
  stateOff: "বন্ধ",
  configLoading: "কনফিগ লোড হচ্ছে…",
  configLoadFailed: "কনফিগ লোড করা যায়নি।",
  configLoadNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ লোড করা যায়নি।",
  configSaveFailed: "কনফিগ সংরক্ষণ করা যায়নি।",
  configSaveNetwork: "নেটওয়ার্ক ত্রুটি — কনফিগ সংরক্ষণ করা যায়নি।",
  configSaved: "কনফিগ সংরক্ষিত হয়েছে।",
  tooManyTables: "সর্বোচ্চ ৫০টি টেবিল রাখা যাবে।",
  reasonRequired: "পরিবর্তনের কারণ লিখুন (অডিটের জন্য আবশ্যক)।",
  tablesLabel: "টেবিল (প্রতি লাইনে একটি লেবেল)",
  tablesPlaceholder: "টেবিল ১\nটেবিল ২\nবারান্দা ১",
  dineInOn: "ডাইন-ইন চালু",
  takeawayOn: "টেকঅওয়ে চালু",
  reasonLabel: "পরিবর্তনের কারণ (আবশ্যক)",
  reasonPlaceholder: "যেমন: নতুন টেবিল যোগ হলো",
  saving: "সংরক্ষণ হচ্ছে…",
  save: "সংরক্ষণ করুন",
};

export type KitchenStrings = { [K in keyof typeof bn]: string };

const en: KitchenStrings = {
  title: "Kitchen (KDS)",
  description:
    "The kitchen queue for restaurant orders — Queued → Preparing → Ready → Served. The board refreshes itself every 15 seconds (polling — not live realtime). When an order is cancelled, its ticket is cancelled automatically too.",
  lockedPrefix: "🔒 This module is locked for this install. Restaurant + kitchen display is a paid add-on — enable",
  lockedSuffix: "in Admin > Settings > Feature Flags to unlock it.",

  boardAria: "Kitchen board",
  boardLoadFailed: "Could not load the kitchen board.",
  boardLoadNetwork: "Network error — could not refresh the board.",
  advanceFailed: "Could not advance the ticket.",
  advanceNetwork: "Network error — could not update the ticket.",
  boardLoading: "Loading the kitchen board…",
  servedTodayLabel: "Served today:",
  cancelledTodayLabel: "Cancelled today:",
  count: "{count}",
  pollNote: "Auto-refreshes every 15 seconds (polling — not live realtime).",
  noTickets: "No tickets.",
  tableLabel: "Table: {label}",
  takeaway: "Takeaway",
  waiting: "Waiting for {mins} min",
  advanceStart: "Start preparing",
  advanceReady: "Mark ready",
  advanceServed: "Served",

  configAria: "Restaurant config",
  configTitle: "Restaurant Settings",
  configIntroA: "The table list and the dine-in / takeaway toggles live in the Setting document",
  configIntroDefaultSuffix: "(nothing saved yet — the code defaults are in effect)",
  configIntroB: "With zero tables, dine-in stays effectively off whatever the toggle says.",
  effectiveLine: "Currently in effect: dine-in {dineIn}, takeaway {takeaway}.",
  stateOn: "On",
  stateOff: "Off",
  configLoading: "Loading config…",
  configLoadFailed: "Could not load the config.",
  configLoadNetwork: "Network error — could not load the config.",
  configSaveFailed: "Could not save the config.",
  configSaveNetwork: "Network error — could not save the config.",
  configSaved: "Config saved.",
  tooManyTables: "At most 50 tables can be kept.",
  reasonRequired: "Enter a reason for the change (required for the audit log).",
  tablesLabel: "Tables (one label per line)",
  tablesPlaceholder: "Table 1\nTable 2\nVeranda 1",
  dineInOn: "Dine-in on",
  takeawayOn: "Takeaway on",
  reasonLabel: "Reason for the change (required)",
  reasonPlaceholder: "e.g. Added new tables",
  saving: "Saving…",
  save: "Save",
};

export const KITCHEN_STRINGS: Record<Locale, KitchenStrings> = { bn, en };
