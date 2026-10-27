/**
 * Admin abandoned checkouts — UI dictionary (doc 30 unified language system).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Customer DATA (names, addresses) is never translated; only UI copy.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "পরিত্যক্ত চেকআউট",
  description:
    "যেসব ক্রেতা ফোন নম্বর দিয়ে কার্টে পণ্য রেখে অর্ডার না করেই চলে গেছেন। ক্যাপচার ৭ দিন পর্যন্ত থাকে — মেয়াদ শেষ হলে তালিকা থেকে সরে যায়। ফোন নম্বর এখানে সবসময় আড়াল করা থাকে; ফলো-আপের জন্য কল টাস্ক তৈরি করুন।",
  ageJustNow: "এইমাত্র",
  ageMinutes: "{n} মিনিট আগে",
  ageHours: "{n} ঘণ্টা আগে",
  ageDays: "{n} দিন আগে",
  loadError: "তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।",
  confirmConvert:
    "এই ক্যাপচার থেকে বর্তমান ক্যাটালগ দামে একটি আসল COD অর্ডার তৈরি হবে এবং স্টক সংরক্ষিত হবে। এগিয়ে যাবেন?",
  confirmDismiss: "এই ক্যাপচারটি বাতিল করা হবে — এটি আর এই তালিকায় আসবে না। নিশ্চিত?",
  actionFailed: "অ্যাকশনটি সম্পন্ন করা যায়নি।",
  alreadyConverted: "এই ক্যাপচার থেকে আগেই অর্ডার হয়েছে: {orderNo}",
  orderCreated: "অর্ডার তৈরি হয়েছে: {orderNo}",
  callTaskCreated: "কল টাস্ক তৈরি হয়েছে — কল সেন্টার কিউতে পাওয়া যাবে।",
  captureDismissed: "ক্যাপচারটি বাতিল করা হয়েছে।",
  networkError: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।",
  emptyTitle: "এখন কোনো খোলা পরিত্যক্ত চেকআউট নেই",
  emptyDescription:
    "ক্রেতা চেকআউটে সঠিক ফোন নম্বর লিখে কার্টে পণ্য রেখে অর্ডার শেষ না করে চলে গেলেই এখানে একটি সারি আসবে। অর্ডার হয়ে যাওয়া বা বাতিল করা ক্যাপচার এই তালিকায় থাকে না।",
  openCaptures: "খোলা ক্যাপচার",
  openCount: "{total}টি",
  potentialSales: "সম্ভাব্য বিক্রি",
  potentialSalesPageSuffix: " (এই পেজে — সর্বশেষ {n}টি)",
  oldest: "সবচেয়ে পুরনো",
  noName: "নাম দেয়নি",
  lastActivity: "শেষ কার্যকলাপ",
  districtMissing: "জেলা পাওয়া যায়নি",
  itemsCount: "{n}টি পণ্য",
  productMissing: "পণ্য পাওয়া যাচ্ছে না",
  capturePriceSuffix: "(ধরার সময়ের দাম)",
  callTaskExists: "কল টাস্ক তৈরি আছে",
  createCallTask: "কল টাস্ক তৈরি করুন",
  convertBtn: "অর্ডারে রূপান্তর করুন",
  dismissBtn: "বাতিল করুন",
  goCallCenter: "কল সেন্টারে যান",
};

export type AbandonedStrings = { [K in keyof typeof bn]: string };

const en: AbandonedStrings = {
  title: "Abandoned Checkouts",
  description:
    "Shoppers who entered a phone number, left items in the cart and left without ordering. Captures stay for 7 days — once expired they drop off this list. Phone numbers are always masked here; create a call task to follow up.",
  ageJustNow: "Just now",
  ageMinutes: "{n} minutes ago",
  ageHours: "{n} hours ago",
  ageDays: "{n} days ago",
  loadError: "The list could not be loaded. Please try again.",
  confirmConvert:
    "A real COD order will be created from this capture at current catalogue prices and stock will be reserved. Continue?",
  confirmDismiss: "This capture will be dismissed — it will no longer appear in this list. Are you sure?",
  actionFailed: "The action could not be completed.",
  alreadyConverted: "An order was already created from this capture: {orderNo}",
  orderCreated: "Order created: {orderNo}",
  callTaskCreated: "Call task created — it will appear in the call centre queue.",
  captureDismissed: "The capture has been dismissed.",
  networkError: "Network problem — please try again.",
  emptyTitle: "No open abandoned checkouts right now",
  emptyDescription:
    "A row appears here when a shopper enters a valid phone number at checkout, leaves items in the cart and leaves without completing the order. Converted or dismissed captures do not stay in this list.",
  openCaptures: "Open captures",
  openCount: "{total}",
  potentialSales: "Potential sales",
  potentialSalesPageSuffix: " (on this page — latest {n})",
  oldest: "Oldest",
  noName: "No name given",
  lastActivity: "Last activity",
  districtMissing: "District not found",
  itemsCount: "{n} items",
  productMissing: "Product not available",
  capturePriceSuffix: "(price at capture time)",
  callTaskExists: "Call task already created",
  createCallTask: "Create call task",
  convertBtn: "Convert to order",
  dismissBtn: "Dismiss",
  goCallCenter: "Go to call centre",
};

export const ABANDONED_STRINGS: Record<Locale, AbandonedStrings> = { bn, en };
