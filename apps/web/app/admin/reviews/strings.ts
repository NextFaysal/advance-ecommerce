/**
 * Admin reviews + product Q&A moderation — UI dictionary (doc 30).
 * bn typed once, en typed as the mapped type — parity is compile-checked.
 * Review/question DATA (author, body, product titles) is never translated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  pageTitle: "রিভিউ মডারেশন",
  pageDescription:
    "আসল রিভিউ ডাটাবেসের Review টেবিল থেকে আসে। অনুমোদিত রিভিউই শুধু পণ্যের পেজে ও হোমপেজে প্রকাশিত হয়; অনুমোদন/প্রত্যাখ্যানের সঙ্গে সঙ্গেই পণ্যের গড় রেটিং আপডেট হয়। ফোন নম্বর যাচাইয়ের জন্য — এখানে মাস্ক করা দেখানো হয়।",
  pageBreadcrumb: "Admin / Catalog",
  qaTitle: "পণ্য প্রশ্নোত্তর মডারেশন",
  qaDescription:
    "গ্রাহকদের পণ্য-সম্পর্কিত প্রশ্ন ProductQuestion টেবিল থেকে আসে। উত্তর দিলেই প্রশ্নোত্তরটি পণ্যের পেজে প্রকাশিত হয়; অনুপযুক্ত প্রশ্ন লুকিয়ে রাখা যায়।",
  // Reviews manager
  tabPending: "অপেক্ষমাণ",
  tabApproved: "অনুমোদিত",
  tabRejected: "প্রত্যাখ্যাত",
  tabAll: "সব",
  badgePending: "অপেক্ষমাণ (PENDING)",
  badgeApproved: "অনুমোদিত (APPROVED)",
  badgeRejected: "প্রত্যাখ্যাত (REJECTED)",
  tabsAria: "রিভিউ স্ট্যাটাস",
  networkError: "নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।",
  networkRetry: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।",
  loading: "লোড হচ্ছে…",
  loadFailed: "রিভিউ লোড করা যায়নি — {error}",
  empty: "এই তালিকায় কোনো রিভিউ নেই। নতুন রিভিউ এলে এখানে মডারেশনের জন্য দেখা যাবে।",
  verifiedBuyer: "যাচাইকৃত ক্রেতা",
  productLabel: "পণ্য:",
  approve: "অনুমোদন করুন",
  reject: "প্রত্যাখ্যান করুন",
  backToPending: "আবার অপেক্ষমাণ করুন",
  // Questions manager
  qTabPending: "উত্তর বাকি",
  qTabAnswered: "উত্তর দেওয়া",
  qTabHidden: "লুকানো",
  qTabAll: "সব",
  qBadgePending: "উত্তর বাকি (PENDING)",
  qBadgeAnswered: "প্রকাশিত (ANSWERED)",
  qBadgeHidden: "লুকানো (HIDDEN)",
  qTabsAria: "প্রশ্নের স্ট্যাটাস",
  qLoadFailed: "প্রশ্ন লোড করা যায়নি।",
  qNetworkError: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।",
  qActionFailed: "কাজটি করা যায়নি।",
  qEmpty: "এই তালিকায় কোনো প্রশ্ন নেই।",
  qPrefix: "প্র: {question}",
  qAsker: "প্রশ্নকারী: {name}",
  qAnswerPrefix: "উ:",
  qAnswerPlaceholder: "উত্তর লিখুন…",
  qUpdateAnswer: "উত্তর আপডেট করুন",
  qAnswerPublish: "উত্তর দিয়ে প্রকাশ করুন",
  qHide: "লুকান",
  qRestore: "ফিরিয়ে আনুন",
};

export type ReviewsAdminStrings = { [K in keyof typeof bn]: string };

const en: ReviewsAdminStrings = {
  pageTitle: "Review Moderation",
  pageDescription:
    "Reviews come from the real Review table in the database. Only approved reviews appear on product pages and the homepage; the product's average rating updates as soon as a review is approved/rejected. Phone numbers are shown masked here — for verification.",
  pageBreadcrumb: "Admin / Catalog",
  qaTitle: "Product Q&A Moderation",
  qaDescription:
    "Customer product questions come from the ProductQuestion table. Answering publishes the Q&A on the product page; unsuitable questions can be hidden.",
  tabPending: "Pending",
  tabApproved: "Approved",
  tabRejected: "Rejected",
  tabAll: "All",
  badgePending: "Pending (PENDING)",
  badgeApproved: "Approved (APPROVED)",
  badgeRejected: "Rejected (REJECTED)",
  tabsAria: "Review status",
  networkError: "Network problem — the API could not be reached.",
  networkRetry: "Network problem — please try again.",
  loading: "Loading…",
  loadFailed: "Reviews could not be loaded — {error}",
  empty: "No reviews in this list. New reviews will appear here for moderation.",
  verifiedBuyer: "Verified buyer",
  productLabel: "Product:",
  approve: "Approve",
  reject: "Reject",
  backToPending: "Move back to pending",
  qTabPending: "Awaiting answer",
  qTabAnswered: "Answered",
  qTabHidden: "Hidden",
  qTabAll: "All",
  qBadgePending: "Awaiting answer (PENDING)",
  qBadgeAnswered: "Published (ANSWERED)",
  qBadgeHidden: "Hidden (HIDDEN)",
  qTabsAria: "Question status",
  qLoadFailed: "Questions could not be loaded.",
  qNetworkError: "Network error — please try again.",
  qActionFailed: "The action could not be completed.",
  qEmpty: "No questions in this list.",
  qPrefix: "Q: {question}",
  qAsker: "Asked by: {name}",
  qAnswerPrefix: "A:",
  qAnswerPlaceholder: "Write an answer…",
  qUpdateAnswer: "Update answer",
  qAnswerPublish: "Answer & publish",
  qHide: "Hide",
  qRestore: "Restore",
};

export const REVIEWS_ADMIN_STRINGS: Record<Locale, ReviewsAdminStrings> = { bn, en };
