import type { Locale } from "@/i18n/locale";

const bn = {
  title: "অনুমোদন",
  description:
    "বড় ছাড়ের অর্ডার ও বড় রিফান্ডের জন্য ম্যানেজারের অনুমোদনের তালিকা। অনুমোদন ছাড়া সংশ্লিষ্ট অর্ডার নিশ্চিত করা বা রিফান্ড পাঠানো যাবে না — কেন আটকে আছে, প্রতিটি অনুরোধেই তা লেখা আছে।",
  kindDiscount: "ছাড়ের অনুমোদন",
  kindRefund: "রিফান্ডের অনুমোদন",
  statusPending: "অনুমোদনের অপেক্ষায়",
  statusApproved: "অনুমোদিত",
  statusRejected: "প্রত্যাখ্যাত",
  discountLine: "ছাড় {pct} ({discount} / মোট {subtotal}) — সীমা {threshold}। অনুমোদন ছাড়া এই অর্ডার নিশ্চিত করা যাবে না।",
  discountLineShort: "ছাড় {pct} — সীমা {threshold}। অনুমোদন ছাড়া এই অর্ডার নিশ্চিত করা যাবে না।",
  refundLine: "রিফান্ড {amount} — সীমা {threshold}। অনুমোদন ছাড়া এই রিফান্ড পাঠানো যাবে না।",
  refundStatusNow: "বর্তমান অবস্থা: {status}।",
  requestedBy: "অনুরোধ",
  decidedBy: "সিদ্ধান্ত",
  reasonLabel: "কারণ",
  reasonPlaceholder: "কারণ (প্রত্যাখ্যানের জন্য আবশ্যক)",
  approve: "অনুমোদন দিন",
  reject: "প্রত্যাখ্যান",
  loadFailed: "লোড করা যায়নি।",
  decideFailed: "সিদ্ধান্ত সংরক্ষণ করা যায়নি।",
  approvedNote: "অনুমোদন দেওয়া হয়েছে — এখন সংশ্লিষ্ট কাজটি আবার চেষ্টা করা যাবে।",
  rejectedNote: "অনুরোধ প্রত্যাখ্যান করা হয়েছে।",
  configEnabledA: "অনুমোদন ব্যবস্থা ",
  configEnabledB:
    " আছে: ছাড় {pct} বা তার বেশি হলে অর্ডার নিশ্চিত করতে ম্যানেজারের অনুমোদন লাগে, আর {amount}-এর বেশি রিফান্ড পাঠাতে অনুমোদন লাগে। সীমা বদলাতে Settings > Orders (orders.approvals.*) ব্যবহার করুন।",
  configEnabledOn: "চালু",
  configDisabledA: "অনুমোদন ব্যবস্থা ",
  configDisabledB:
    " আছে (Settings: orders.approvals.enabled) — নতুন কোনো অনুরোধ তৈরি হচ্ছে না; নিচের তালিকাটি আগের রেকর্ড মাত্র।",
  configDisabledOff: "বন্ধ",
  loading: "লোড হচ্ছে…",
  loadError: "তালিকা লোড করা যায়নি। আবার চেষ্টা করুন।",
  noPending: "অপেক্ষমাণ কোনো অনুরোধ নেই।",
  recentDecisions: "সাম্প্রতিক সিদ্ধান্ত",
};

export type ApprovalsStrings = { [K in keyof typeof bn]: string };

const en: ApprovalsStrings = {
  title: "Approvals",
  description:
    "The manager approval queue for large-discount orders and large refunds. Without approval the order cannot be confirmed or the refund sent — each request states why it is blocked.",
  kindDiscount: "Discount approval",
  kindRefund: "Refund approval",
  statusPending: "Awaiting approval",
  statusApproved: "Approved",
  statusRejected: "Rejected",
  discountLine: "Discount {pct} ({discount} / subtotal {subtotal}) — threshold {threshold}. This order cannot be confirmed without approval.",
  discountLineShort: "Discount {pct} — threshold {threshold}. This order cannot be confirmed without approval.",
  refundLine: "Refund {amount} — threshold {threshold}. This refund cannot be sent without approval.",
  refundStatusNow: "Current status: {status}.",
  requestedBy: "Requested",
  decidedBy: "Decided",
  reasonLabel: "Reason",
  reasonPlaceholder: "Reason (required for rejection)",
  approve: "Approve",
  reject: "Reject",
  loadFailed: "Could not be loaded.",
  decideFailed: "The decision could not be saved.",
  approvedNote: "Approved — the related action can now be tried again.",
  rejectedNote: "The request has been rejected.",
  configEnabledA: "Approvals are ",
  configEnabledB:
    ": a discount of {pct} or more needs a manager's approval to confirm the order, and a refund over {amount} needs approval to be sent. To change the thresholds use Settings > Orders (orders.approvals.*).",
  configEnabledOn: "ON",
  configDisabledA: "Approvals are ",
  configDisabledB:
    " (Settings: orders.approvals.enabled) — no new requests are being created; the list below is past records only.",
  configDisabledOff: "OFF",
  loading: "Loading…",
  loadError: "The list could not be loaded. Please try again.",
  noPending: "No pending requests.",
  recentDecisions: "Recent decisions",
};

export const APPROVALS_STRINGS: Record<Locale, ApprovalsStrings> = { bn, en };
