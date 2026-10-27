/**
 * Admin pharmacy (Rx verification) — UI dictionary (doc 30 unified
 * language system). bn typed once, en typed as the mapped type —
 * parity is compile-checked. Prescription DATA (prescriber names,
 * registration numbers from the DB) is never translated.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Page
  title: "প্রেসক্রিপশন যাচাই",
  description:
    "প্রেসক্রিপশন-আবশ্যক পণ্যের অর্ডারগুলো এখানে ফার্মাসিস্টের সিদ্ধান্তের অপেক্ষায় থাকে — অনুমোদন ছাড়া এই অর্ডার নিশ্চিত (CONFIRMED) করা যায় না। গ্রাহকের দেওয়া তথ্য একটি রেকর্ড মাত্র; যাচাইয়ের সিদ্ধান্ত এখানেই নথিভুক্ত হয়।",
  lockedTitle: "এই মডিউলটি লক করা আছে",
  lockedPrefix: "ফার্মেসি প্যাক একটি পেইড অ্যাড-অন (ADV-22)। চালু করতে Admin → Feature Flags থেকে",
  lockedSuffix: "সক্রিয় করুন।",

  // Queue panel
  loadFailed: "কিউ লোড করা যায়নি।",
  networkError: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।",
  noteRequired: "সিদ্ধান্তের সঙ্গে একটি মন্তব্য লিখুন — যাচাইয়ের রেকর্ড হিসেবে এটি অর্ডারে থাকবে।",
  decisionSaveFailed: "সিদ্ধান্ত সংরক্ষণ করা যায়নি।",
  approvedMsg: "{orderNo}: প্রেসক্রিপশন অনুমোদিত — অর্ডারটি এখন নিশ্চিত করা যাবে।",
  rejectedMsg: "{orderNo}: প্রেসক্রিপশন বাতিল — অর্ডারটি নিশ্চিত করা যাবে না; প্রয়োজনে অর্ডার বাতিল করুন।",
  loading: "লোড হচ্ছে…",
  emptyTitle: "কিউ খালি",
  emptyText: "যাচাইয়ের অপেক্ষায় কোনো প্রেসক্রিপশন অর্ডার নেই।",
  totalLabel: "মোট {amount}",
  statusLabel: "অবস্থা:",
  prescriberLabel: "চিকিৎসক:",
  registrationLabel: "রেজিস্ট্রেশন নং:",
  imageLabel: "ছবি:",
  imageLink: "গ্রাহকের দেওয়া লিংক খুলুন",
  attestationNote:
    "গ্রাহক নিশ্চিত করেছেন যে তাঁর কাছে প্রেসক্রিপশনটি আছে — এটি যাচাইকৃত প্রেসক্রিপশন নয়, যাচাইয়ের সিদ্ধান্ত আপনার।",
  noRecordWarning:
    "সতর্কতা: এই অর্ডারে প্রেসক্রিপশন রেকর্ড পাওয়া যায়নি — অনুমোদনের আগে গ্রাহকের সঙ্গে যোগাযোগ করুন।",
  noteLabel: "সিদ্ধান্তের মন্তব্য (আবশ্যক)",
  notePlaceholder: "যেমন: প্রেসক্রিপশন মিলিয়ে দেখা হয়েছে",
  approveBtn: "✓ অনুমোদন করুন",
  rejectBtn: "✕ বাতিল করুন",
  openOrder: "অর্ডার খুলুন",
};

export type PharmacyStrings = { [K in keyof typeof bn]: string };

const en: PharmacyStrings = {
  title: "Prescription Verification",
  description:
    "Orders for prescription-required products wait here for the pharmacist's decision — without approval such an order cannot be confirmed (CONFIRMED). The information the customer provided is only a record; the verification decision is documented here.",
  lockedTitle: "This module is locked",
  lockedPrefix: "The pharmacy pack is a paid add-on (ADV-22). To enable it, activate",
  lockedSuffix: "from Admin → Feature Flags.",

  loadFailed: "Could not load the queue.",
  networkError: "Network problem — please try again.",
  noteRequired: "Write a note with your decision — it stays on the order as the verification record.",
  decisionSaveFailed: "Could not save the decision.",
  approvedMsg: "{orderNo}: Prescription approved — the order can now be confirmed.",
  rejectedMsg: "{orderNo}: Prescription rejected — the order cannot be confirmed; cancel the order if needed.",
  loading: "Loading…",
  emptyTitle: "Queue is empty",
  emptyText: "No prescription orders are waiting for verification.",
  totalLabel: "Total {amount}",
  statusLabel: "Status:",
  prescriberLabel: "Prescriber:",
  registrationLabel: "Registration no.:",
  imageLabel: "Image:",
  imageLink: "Open the customer-provided link",
  attestationNote:
    "The customer has confirmed they hold the prescription — this is not a verified prescription; the verification decision is yours.",
  noRecordWarning:
    "Warning: no prescription record was found for this order — contact the customer before approving.",
  noteLabel: "Decision note (required)",
  notePlaceholder: "e.g. Prescription checked and matched",
  approveBtn: "✓ Approve",
  rejectBtn: "✕ Reject",
  openOrder: "Open order",
};

export const PHARMACY_STRINGS: Record<Locale, PharmacyStrings> = { bn, en };
