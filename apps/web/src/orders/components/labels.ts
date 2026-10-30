// Bangla labels for order statuses — shared by the Order Workspace components.
// Display only; the state machine (src/orders/state-machine.ts) stays the
// single source of truth for which transitions are allowed.
import type { IconName } from "../../components/ui/icon";
import type { OrderStatus, PaymentStatus } from "../types";
import type { RefundStatus } from "../refunds";

export const ORDER_STATUS_BN: Record<OrderStatus, string> = {
  INCOMPLETE: "অসম্পূর্ণ অর্ডার",
  PENDING: "পেন্ডিং",
  CONFIRMED: "কনফার্ম করা",
  PROCESSING: "প্রসেসিং",
  PACKED: "প্যাক করা",
  SHIPPED: "পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারি সম্পন্ন",
  FAILED: "ব্যর্থ",
  RETURN_REQUESTED: "রিটার্ন অনুরোধ",
  RETURNING: "রিটার্ন আসছে",
  RETURNED: "রিটার্ন এসেছে",
  CANCELLED: "বাতিল",
  REFUNDED: "রিফান্ড করা",
  EXCHANGED: "এক্সচেঞ্জ করা",
};

/* ------------------------------------------------------------------ */
/* OD0 (doc 19 §2.1) — the ONE status language for order surfaces.     */
/* Every order status, payment state and refund state resolves to a    */
/* single { tone, icon, labelBn, labelEn } entry here; badges, the     */
/* timeline, kanban, list rows and customer tracking all consume these */
/* maps instead of keeping local copies. `tone` is the ui Badge /      */
/* status-badge variant set; `icon` is a verified IconName from        */
/* src/components/ui/icon.tsx (kebab-case set — no lucide names).      */
/* Status is never colour-only: tone + icon + text travel together.    */
/* ------------------------------------------------------------------ */

export type StatusTone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusVisual {
  tone: StatusTone;
  icon: IconName;
  labelBn: string;
  labelEn: string;
}

/** Dot colour class per tone — mirrors the dot record in ui/badge.tsx so
 *  timeline dots / kanban dots match badge tones exactly. */
export const STATUS_TONE_DOT_CLASS: Record<StatusTone, string> = {
  brand: "bg-brand-500",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-rose-500",
  info: "bg-sky-500",
  neutral: "bg-slate-400",
};

export const ORDER_STATUS_VISUAL: Record<OrderStatus, StatusVisual> = {
  INCOMPLETE: { tone: "warning", icon: "alert", labelBn: ORDER_STATUS_BN.INCOMPLETE, labelEn: "Incomplete" },
  PENDING: { tone: "warning", icon: "clock", labelBn: ORDER_STATUS_BN.PENDING, labelEn: "Pending" },
  CONFIRMED: { tone: "info", icon: "check", labelBn: ORDER_STATUS_BN.CONFIRMED, labelEn: "Confirmed" },
  PROCESSING: { tone: "brand", icon: "refresh-ccw", labelBn: ORDER_STATUS_BN.PROCESSING, labelEn: "Processing" },
  PACKED: { tone: "brand", icon: "package", labelBn: ORDER_STATUS_BN.PACKED, labelEn: "Packed" },
  SHIPPED: { tone: "info", icon: "truck", labelBn: ORDER_STATUS_BN.SHIPPED, labelEn: "Shipped" },
  DELIVERED: { tone: "success", icon: "check", labelBn: ORDER_STATUS_BN.DELIVERED, labelEn: "Delivered" },
  FAILED: { tone: "danger", icon: "alert", labelBn: ORDER_STATUS_BN.FAILED, labelEn: "Failed" },
  RETURN_REQUESTED: { tone: "warning", icon: "rotate-ccw", labelBn: ORDER_STATUS_BN.RETURN_REQUESTED, labelEn: "Return requested" },
  RETURNING: { tone: "warning", icon: "truck", labelBn: ORDER_STATUS_BN.RETURNING, labelEn: "Returning" },
  RETURNED: { tone: "neutral", icon: "rotate-ccw", labelBn: ORDER_STATUS_BN.RETURNED, labelEn: "Returned" },
  CANCELLED: { tone: "neutral", icon: "x", labelBn: ORDER_STATUS_BN.CANCELLED, labelEn: "Cancelled" },
  REFUNDED: { tone: "info", icon: "banknote", labelBn: ORDER_STATUS_BN.REFUNDED, labelEn: "Refunded" },
  EXCHANGED: { tone: "info", icon: "refresh-ccw", labelBn: ORDER_STATUS_BN.EXCHANGED, labelEn: "Exchanged" },
};

export const PAYMENT_STATUS_BN: Record<PaymentStatus, string> = {
  UNPAID: "অপরিশোধিত",
  PARTIAL: "আংশিক পরিশোধিত",
  PAID: "পরিশোধিত",
  FAILED: "ব্যর্থ",
  REFUNDED: "রিফান্ড করা",
  PARTIALLY_REFUNDED: "আংশিক রিফান্ড",
};

export const PAYMENT_STATUS_VISUAL: Record<PaymentStatus, StatusVisual> = {
  UNPAID: { tone: "warning", icon: "clock", labelBn: PAYMENT_STATUS_BN.UNPAID, labelEn: "Unpaid" },
  PARTIAL: { tone: "info", icon: "banknote", labelBn: PAYMENT_STATUS_BN.PARTIAL, labelEn: "Partially paid" },
  PAID: { tone: "success", icon: "check", labelBn: PAYMENT_STATUS_BN.PAID, labelEn: "Paid" },
  FAILED: { tone: "danger", icon: "alert", labelBn: PAYMENT_STATUS_BN.FAILED, labelEn: "Failed" },
  REFUNDED: { tone: "info", icon: "rotate-ccw", labelBn: PAYMENT_STATUS_BN.REFUNDED, labelEn: "Refunded" },
  PARTIALLY_REFUNDED: { tone: "warning", icon: "rotate-ccw", labelBn: PAYMENT_STATUS_BN.PARTIALLY_REFUNDED, labelEn: "Partially refunded" },
};

export const REFUND_STATUS_BN: Record<RefundStatus, string> = {
  PENDING: "অপেক্ষমাণ",
  SENT: "পাঠানো হয়েছে",
  CONFIRMED: "নিশ্চিত",
  CANCELLED: "বাতিল",
};

export const REFUND_STATUS_VISUAL: Record<RefundStatus, StatusVisual> = {
  PENDING: { tone: "warning", icon: "clock", labelBn: REFUND_STATUS_BN.PENDING, labelEn: "Pending" },
  SENT: { tone: "info", icon: "banknote", labelBn: REFUND_STATUS_BN.SENT, labelEn: "Sent" },
  CONFIRMED: { tone: "success", icon: "check", labelBn: REFUND_STATUS_BN.CONFIRMED, labelEn: "Confirmed" },
  CANCELLED: { tone: "neutral", icon: "x", labelBn: REFUND_STATUS_BN.CANCELLED, labelEn: "Cancelled" },
};

export function formatDhakaTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("bn-BD", {
      timeZone: "Asia/Dhaka",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
