/**
 * BD Tools admin page — shared labels (doc 30 unified language system).
 *
 * Client-safe: pure data + type-only imports from src/bd/* (the pure
 * service modules themselves are NOT imported here, so this file can be
 * used by both the server page and the client panels).
 *
 * Labels only — every computation stays in src/bd/* (Agent 11). The
 * customer-facing payment-link status labels live in
 * src/storefront-ux/pay-link-view.ts (PAYMENT_LINK_STATUS_LABELS_BN);
 * the wording below is the staff-facing variant. All label maps are
 * functions of the active locale — callers pass the locale they got
 * from useLocale() / getRequestLocale().
 */
import type { CashChannelName } from "@/bd/cash-closing";
import type { ReconciliationStatus } from "@/bd/courier-reconciliation";
import type { PaymentLinkStatus } from "@/bd/payment-link";
import type { ParseMerchantSmsResult } from "@/bd/sms-autoverify";
import { intlLocale, pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";

function s(locale: Locale): BdToolsStrings {
  return pick(locale, BD_TOOLS_STRINGS);
}

export function channelLabels(locale: Locale): Record<CashChannelName, string> {
  const t = s(locale);
  return {
    cash: t.channelCash,
    bkash: t.channelBkash,
    nagad: t.channelNagad,
    courier_cod: t.channelCourierCod,
  };
}

export function reconciliationStatusLabels(locale: Locale): Record<ReconciliationStatus, string> {
  const t = s(locale);
  return {
    matched: t.reconMatched,
    amount_mismatch: t.reconAmountMismatch,
    charge_mismatch: t.reconChargeMismatch,
    missing_in_invoice: t.reconMissing,
    extra_in_invoice: t.reconExtra,
    tracking_mismatch: t.reconTrackingMismatch,
  };
}

/** Dispute reason codes from src/bd/courier-reconciliation.ts, localized.
 *  Reasons carry values after a ":" — the prefix is translated and the
 *  original code is still shown in mono next to it, never hidden. */
export function reconciliationReason(reason: string, locale: Locale): string {
  const t = s(locale);
  const prefix = reason.split(":")[0] ?? reason;
  switch (prefix) {
    case "cod_collected_differs":
      return t.reasonCodDiffers;
    case "a_charge_differs":
      return t.reasonChargeDiffers;
    case "payable_differs":
      return t.reasonPayableDiffers;
    case "tracking_id_differs":
      return t.reasonTrackingDiffers;
    case "shipment_not_billed_by_courier":
      return t.reasonNotBilled;
    case "courier_billed_unknown_shipment":
      return t.reasonUnknownShipment;
    default:
      return reason;
  }
}

export function paymentLinkStatusLabels(locale: Locale): Record<PaymentLinkStatus, string> {
  const t = s(locale);
  return {
    active: t.paylinkActive,
    paid: t.paylinkPaid,
    expired: t.paylinkExpired,
    cancelled: t.paylinkCancelled,
  };
}

export function paymentLinkPurposes(locale: Locale): readonly { value: string; label: string }[] {
  const t = s(locale);
  return [
    { value: "cod_advance", label: t.purposeCodAdvance },
    { value: "partial", label: t.purposePartial },
    { value: "due", label: t.purposeDue },
  ];
}

export function paymentLinkPurpose(purpose: string, locale: Locale): string {
  return paymentLinkPurposes(locale).find((p) => p.value === purpose)?.label ?? purpose;
}

type SmsRejectReason = Extract<ParseMerchantSmsResult, { ok: false }>["reason"];

export function smsRejectReasonLabels(locale: Locale): Record<SmsRejectReason, string> {
  const t = s(locale);
  return {
    empty: t.smsEmpty,
    no_provider: t.smsNoProvider,
    no_trxid: t.smsNoTrxid,
    no_amount: t.smsNoAmount,
  };
}

export function matchedByLabels(locale: Locale): Record<string, string> {
  const t = s(locale);
  return {
    bangla: t.matchedBangla,
    latin: t.matchedLatin,
    typo: t.matchedTypo,
    implied: t.matchedImplied,
  };
}

/** Asia/Dhaka date-time for ISO strings, in the active locale. Display only. */
export function formatDateTime(iso: string, locale: Locale): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(isoDate: string, locale: Locale): string {
  const d = new Date(`${isoDate}T00:00:00+06:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(intlLocale(locale), {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
