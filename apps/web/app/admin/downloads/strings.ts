/**
 * Admin download re-issue desk — UI dictionary (doc 30 unified language).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Customer/order/file DATA is never translated; API error messages pass
 * through as data.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  title: "ডাউনলোড রি-ইস্যু",
  description:
    "ডিজিটাল পণ্যের হারানো/মেয়াদোত্তীর্ণ ডাউনলোড লিংকের বদলি অনুরোধ। অনুমোদন দিলে নতুন গ্রান্ট তৈরি হয় ও পুরনোটি বাতিল হয় — পুরনো টোকেন কোনোভাবেই ফেরত পাওয়া যায় না (শুধু হ্যাশ রাখা হয়)।",
  reqPending: "অপেক্ষমাণ",
  reqApproved: "অনুমোদিত",
  reqRejected: "বাতিল",
  grantActive: "সক্রিয়",
  grantExpired: "মেয়াদ শেষ",
  grantExhausted: "ডাউনলোড শেষ",
  grantRevoked: "বাতিলকৃত",
  filterAll: "সব",
  loadFailed: "লোড ব্যর্থ হয়েছে",
  actionFailed: "অ্যাকশন ব্যর্থ হয়েছে",
  lookupFailed: "খোঁজ ব্যর্থ হয়েছে",
  rejectNeedsNote: "বাতিল করতে হলে কারণ (নোট) লিখতে হবে।",
  approvedNotice:
    "অনুমোদিত — নতুন ডাউনলোড তৈরি হয়েছে এবং পুরনো লিংকটি বাতিল করা হয়েছে। গ্রাহক এখন অ্যাকাউন্ট থেকেই ডাউনলোড করতে পারবেন।",
  rejectedNotice: "অনুরোধটি বাতিল করা হয়েছে। পুরনো ডাউনলোডে কোনো পরিবর্তন হয়নি।",
  oneTimeLinkLabel: "একবারের ডাউনলোড লিংক (শুধু এখনই দেখা যাচ্ছে):",
  lookupTitle: "অর্ডার দিয়ে ডাউনলোড খুঁজুন",
  lookupPlaceholder: "অর্ডার নম্বর (যেমন ORD-20261025-0001)",
  searching: "খোঁজা হচ্ছে…",
  search: "খুঁজুন",
  noGrants: "{orderNo} অর্ডারে কোনো ডাউনলোড গ্রান্ট নেই।",
  issuedLabel: "দেওয়া: {date}",
  expiresLabel: "মেয়াদ: {date}",
  usageLabel: "ব্যবহার {used}/{max}",
  reissuePendingSuffix: " · রি-ইস্যু অনুরোধ অপেক্ষমাণ",
  totalLabel: "মোট {total}টি",
  emptyTitle: "এই ফিল্টারে কোনো অনুরোধ নেই",
  emptyDesc:
    "ডাউনলোড রি-ইস্যুর নতুন অনুরোধ এলে এখানে দেখা যাবে। গ্রাহক তাদের অ্যাকাউন্টের ডাউনলোড অংশ থেকে অনুরোধ পাঠান।",
  orderLabel: "অর্ডার",
  requestedLabel: "অনুরোধ: {date}",
  oldGrantLabel: "পুরনো গ্রান্ট: ব্যবহার {used}/{max}, মেয়াদ {date}",
  customerReason: "গ্রাহকের কারণ: {reason}",
  decisionNote: "সিদ্ধান্তের নোট: {note}",
  grantPrefix: "গ্রান্ট: {label}",
  notePlaceholder: "নোট (বাতিলের জন্য আবশ্যক)",
  working: "হচ্ছে…",
  approve: "অনুমোদন — নতুন গ্রান্ট",
  reject: "বাতিল",
  prevPage: "আগের পেজ",
  pageLabel: "পেজ {page} / {total}",
  nextPage: "পরের পেজ",
};

export type DownloadsStrings = { [K in keyof typeof bn]: string };

const en: DownloadsStrings = {
  title: "Download Re-issue",
  description:
    "Replacement requests for lost/expired download links of digital products. Approving creates a new grant and revokes the old one — the old token can never be recovered (only its hash is kept).",
  reqPending: "Pending",
  reqApproved: "Approved",
  reqRejected: "Rejected",
  grantActive: "Active",
  grantExpired: "Expired",
  grantExhausted: "Downloads used up",
  grantRevoked: "Revoked",
  filterAll: "All",
  loadFailed: "Loading failed",
  actionFailed: "The action failed",
  lookupFailed: "The lookup failed",
  rejectNeedsNote: "A reason (note) is required to reject.",
  approvedNotice:
    "Approved — a new download has been created and the old link revoked. The customer can now download from their account.",
  rejectedNotice: "The request has been rejected. The old download is unchanged.",
  oneTimeLinkLabel: "One-time download link (visible only now):",
  lookupTitle: "Find downloads by order",
  lookupPlaceholder: "Order number (e.g. ORD-20261025-0001)",
  searching: "Searching…",
  search: "Search",
  noGrants: "Order {orderNo} has no download grants.",
  issuedLabel: "Issued: {date}",
  expiresLabel: "Expires: {date}",
  usageLabel: "Used {used}/{max}",
  reissuePendingSuffix: " · Re-issue request pending",
  totalLabel: "{total} in total",
  emptyTitle: "No requests under this filter",
  emptyDesc:
    "New download re-issue requests will appear here. Customers send requests from the downloads section of their account.",
  orderLabel: "Order",
  requestedLabel: "Requested: {date}",
  oldGrantLabel: "Old grant: used {used}/{max}, expires {date}",
  customerReason: "Customer's reason: {reason}",
  decisionNote: "Decision note: {note}",
  grantPrefix: "Grant: {label}",
  notePlaceholder: "Note (required to reject)",
  working: "Working…",
  approve: "Approve — new grant",
  reject: "Reject",
  prevPage: "Previous page",
  pageLabel: "Page {page} / {total}",
  nextPage: "Next page",
};

export const DOWNLOADS_STRINGS: Record<Locale, DownloadsStrings> = { bn, en };
