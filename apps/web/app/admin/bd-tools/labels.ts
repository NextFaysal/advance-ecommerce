/**
 * BD Tools admin page — shared Bangla labels (Agent 41).
 *
 * Client-safe: pure data + type-only imports from src/bd/* (the pure
 * service modules themselves are NOT imported here, so this file can be
 * used by both the server page and the client panels).
 *
 * Labels only — every computation stays in src/bd/* (Agent 11). The
 * customer-facing payment-link status labels live in
 * src/storefront-ux/pay-link-view.ts (PAYMENT_LINK_STATUS_LABELS_BN);
 * the wording below is the staff-facing variant.
 */
import type { CashChannelName } from "@/bd/cash-closing";
import type { ReconciliationStatus } from "@/bd/courier-reconciliation";
import type { PaymentLinkStatus } from "@/bd/payment-link";
import type { ParseMerchantSmsResult } from "@/bd/sms-autoverify";

export const CHANNEL_LABELS_BN: Record<CashChannelName, string> = {
  cash: "নগদ (ক্যাশ ড্রয়ার)",
  bkash: "বিকাশ (bKash)",
  nagad: "নগদ (Nagad)",
  courier_cod: "কুরিয়ার COD প্রাপ্য",
};

export const RECONCILIATION_STATUS_LABELS_BN: Record<ReconciliationStatus, string> = {
  matched: "মিলেছে",
  amount_mismatch: "COD টাকার অমিল",
  charge_mismatch: "চার্জের অমিল",
  missing_in_invoice: "ইনভয়েসে নেই",
  extra_in_invoice: "ইনভয়েসে অতিরিক্ত",
  tracking_mismatch: "ট্র্যাকিং আইডির অমিল",
};

/** Dispute reason codes from src/bd/courier-reconciliation.ts -> Bangla.
 *  Reasons carry values after a ":" — the prefix is translated and the
 *  original code is still shown in mono next to it, never hidden. */
export function reconciliationReasonBn(reason: string): string {
  const prefix = reason.split(":")[0] ?? reason;
  switch (prefix) {
    case "cod_collected_differs":
      return "সংগ্রহ করা COD মিলছে না";
    case "a_charge_differs":
      return "ডেলিভারি / COD ফি / রিটার্ন চার্জের যেকোনো একটি মিলছে না";
    case "payable_differs":
      return "পরিশোধযোগ্য টাকা মিলছে না";
    case "tracking_id_differs":
      return "ট্র্যাকিং আইডি আলাদা";
    case "shipment_not_billed_by_courier":
      return "আমরা পাঠিয়েছি, কুরিয়ার বিল করেনি";
    case "courier_billed_unknown_shipment":
      return "কুরিয়ার এমন শিপমেন্টের বিল করেছে যা আমাদের কাছে নেই";
    default:
      return reason;
  }
}

export const PAYMENT_LINK_STATUS_LABELS_BN: Record<PaymentLinkStatus, string> = {
  active: "সক্রিয়",
  paid: "পরিশোধিত",
  expired: "মেয়াদ শেষ",
  cancelled: "বাতিল",
};

export const PAYMENT_LINK_PURPOSES: readonly { value: string; labelBn: string }[] = [
  { value: "cod_advance", labelBn: "COD অগ্রিম" },
  { value: "partial", labelBn: "আংশিক পেমেন্ট" },
  { value: "due", labelBn: "বকেয়া আদায়" },
];

export function paymentLinkPurposeBn(purpose: string): string {
  return PAYMENT_LINK_PURPOSES.find((p) => p.value === purpose)?.labelBn ?? purpose;
}

type SmsRejectReason = Extract<ParseMerchantSmsResult, { ok: false }>["reason"];

export const SMS_REJECT_REASON_LABELS_BN: Record<SmsRejectReason, string> = {
  empty: "মেসেজ খালি — কিছু পেস্ট করুন",
  no_provider: "প্রোভাইডার চেনা যায়নি — মেসেজে bKash/Nagad-এর উল্লেখ নেই",
  no_trxid:
    "কোনো TrxID পাওয়া যায়নি — OTP-শুধু মেসেজ কখনো পেমেন্ট হিসেবে ধরা হয় না",
  no_amount: "টাকার পরিমাণ (Tk/Taka/৳) পাওয়া যায়নি",
};

export const MATCHED_BY_LABELS_BN: Record<string, string> = {
  bangla: "বাংলা নামে মিলেছে",
  latin: "ইংরেজি নামে মিলেছে",
  typo: "বানান সংশোধন করে মিলেছে",
  implied: "অন্য অংশ থেকে অনুমিত",
};

/** Asia/Dhaka date-time for ISO strings, Bangla locale. Display only. */
export function formatDateTimeBn(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateBn(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00+06:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
