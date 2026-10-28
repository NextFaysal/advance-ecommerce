/**
 * Admin own-riders — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Rider DATA (names, phones, zone names from the module catalogue,
 * vehicle strings) is never translated; only UI copy lives here.
 * The live assignment board below the table is a shared component
 * (src/components/admin/rider-assignment-board) whose strings live in
 * ADMIN_STRINGS — already migrated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  lockedTitle: "নিজের রাইডার",
  lockedDesc: "নিজস্ব ডেলিভারি রাইডার ব্যবস্থাপনা (E3)",
  lockedText:
    "🔒 এই মডিউলটি এই ইনস্টলের জন্য লক করা আছে। নিজের রাইডার ব্যবস্থাপনা একটি পেইড অ্যাড-অন — আনলক করতে Admin > Settings > Feature Flags থেকে {flag} চালু করুন।",
  title: "নিজের রাইডার",
  description:
    "আসল ডেটা — Rider ও RiderDelivery টেবিল থেকে (রাইডার API-র একই স্টোর)। জোনের নাম মডিউলের নির্দিষ্ট ক্যাটালগ — কোনো Zone টেবিল নেই। অ্যাসাইনমেন্ট হয় নিকটতম জোন + সবচেয়ে কম লোডের স্কোরে।",
  statRiders: "রাইডার",
  availableDelta: "{count}জন উপলব্ধ",
  statInFlight: "চলমান ডেলিভারি",
  statInFlightDelta: "অ্যাসাইন করা + পিকআপ করা",
  statDelivered: "ডেলিভারি সম্পন্ন",
  statDeliveredDelta: "প্রমাণসহ",
  statCodShortages: "COD ঘাটতি",
  shortageNeedsReview: "পর্যালোচনা দরকার",
  shortageNone: "কোনোটি চিহ্নিত নয়",
  emptyTitle: "এখনো কোনো রাইডার নিবন্ধিত হয়নি",
  emptyDesc: "রাইডার API দিয়ে রাইডার যোগ হলে তাদের ডেলিভারি ইতিহাসসহ এখানে দেখা যাবে।",
  emptyNote:
    "এখনো কোনো রাইডার নিবন্ধিত হয়নি — রাইডার API দিয়ে যোগ করা রাইডাররা তাদের ডেলিভারির ইতিহাসসহ এখানে দেখা যাবে। নিচের টেবিলগুলো খালি কারণ টেবিলগুলোই খালি, নমুনা ডেটা নয়।",
  ridersHeading: "রাইডার",
  tableCaption: "রাইডার তালিকা — ফোন মাস্ক করা, পেআউট = প্রতি ডেলিভারির রেট × ডেলিভারি সম্পন্ন",
  colRider: "রাইডার",
  colPhone: "ফোন",
  colZone: "জোন",
  colVehicle: "যানবাহন",
  colStatus: "স্ট্যাটাস",
  colLoad: "লোড",
  colDelivered: "ডেলিভারি সম্পন্ন",
  colSuccess: "সাফল্য",
  colPayout: "পাওনা পেআউট",
  statusActive: "সক্রিয়",
  statusInactive: "নিষ্ক্রিয়",
  statusOnDelivery: "ডেলিভারিতে আছে",
  statusSuspended: "স্থগিত",
};

export type RidersStrings = { [K in keyof typeof bn]: string };

const en: RidersStrings = {
  lockedTitle: "Own Riders",
  lockedDesc: "In-house delivery rider management (E3)",
  lockedText:
    "🔒 This module is locked for this install. Own rider management is a paid add-on — enable {flag} in Admin > Settings > Feature Flags to unlock it.",
  title: "Own Riders",
  description:
    "Real data from the Rider and RiderDelivery tables (same store as the riders API). Zone names are the module's fixed catalogue — there is no Zone table. Assignment uses nearest-zone + lowest-load scoring.",
  statRiders: "Riders",
  availableDelta: "{count} available",
  statInFlight: "In-flight deliveries",
  statInFlightDelta: "assigned + picked up",
  statDelivered: "Delivered",
  statDeliveredDelta: "with proof",
  statCodShortages: "COD shortages",
  shortageNeedsReview: "needs review",
  shortageNone: "none flagged",
  emptyTitle: "No riders registered yet",
  emptyDesc: "Riders added via the riders API will appear here with their delivery history.",
  emptyNote:
    "No riders are registered yet — riders added via the riders API will appear here with their delivery history. The tables below are empty because the tables are empty, not sample data.",
  ridersHeading: "Riders",
  tableCaption: "Rider list — phone masked, payout is per-delivery rate × delivered",
  colRider: "Rider",
  colPhone: "Phone",
  colZone: "Zone",
  colVehicle: "Vehicle",
  colStatus: "Status",
  colLoad: "Load",
  colDelivered: "Delivered",
  colSuccess: "Success",
  colPayout: "Payout due",
  statusActive: "Active",
  statusInactive: "Inactive",
  statusOnDelivery: "On delivery",
  statusSuspended: "Suspended",
};

export const RIDERS_STRINGS: Record<Locale, RidersStrings> = { bn, en };
