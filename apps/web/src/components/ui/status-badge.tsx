"use client";

import { Badge } from "./badge";
import { Icon, type IconName } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS, type AdminStrings } from "@/admin/strings";

/* Status is NEVER color-only: always color + icon + text. Icons are the
   v2 inline SVG set (icon.tsx), rendered at 12px inside the badge.
   Labels are locale-resolved from the admin dictionary (doc 30). */
export type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED" | "RETURNED" | "REFUNDED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "FAILED" | "REFUNDED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

type Tone = "warning" | "info" | "brand" | "success" | "danger" | "neutral";

const orderMeta: Record<OrderStatus, { icon: IconName; tone: Tone }> = {
  PENDING: { icon: "clock", tone: "warning" },
  CONFIRMED: { icon: "check", tone: "info" },
  PROCESSING: { icon: "refresh-ccw", tone: "brand" },
  PACKED: { icon: "package", tone: "brand" },
  SHIPPED: { icon: "truck", tone: "info" },
  DELIVERED: { icon: "check", tone: "success" },
  CANCELLED: { icon: "x", tone: "neutral" },
  FAILED: { icon: "alert", tone: "danger" },
  RETURNED: { icon: "rotate-ccw", tone: "warning" },
  REFUNDED: { icon: "banknote", tone: "info" },
};

const paymentMeta: Record<PaymentStatus, { icon: IconName; tone: Tone }> = {
  UNPAID: { icon: "clock", tone: "warning" },
  PARTIAL: { icon: "banknote", tone: "info" },
  PAID: { icon: "check", tone: "success" },
  FAILED: { icon: "alert", tone: "danger" },
  REFUNDED: { icon: "rotate-ccw", tone: "info" },
};

const riskMeta: Record<RiskLevel, { tone: "success" | "warning" | "danger" }> = {
  LOW: { tone: "success" },
  MEDIUM: { tone: "warning" },
  HIGH: { tone: "danger" },
};

function orderLabel(s: AdminStrings, status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    PENDING: s.statusPending,
    CONFIRMED: s.statusConfirmed,
    PROCESSING: s.statusProcessing,
    PACKED: s.statusPacked,
    SHIPPED: s.statusShipped,
    DELIVERED: s.statusDelivered,
    CANCELLED: s.statusCancelled,
    FAILED: s.statusFailed,
    RETURNED: s.statusReturned,
    REFUNDED: s.statusRefunded,
  };
  return labels[status];
}

function paymentLabel(s: AdminStrings, status: PaymentStatus): string {
  const labels: Record<PaymentStatus, string> = {
    UNPAID: s.payUnpaid,
    PARTIAL: s.payPartial,
    PAID: s.payPaid,
    FAILED: s.payFailed,
    REFUNDED: s.payRefunded,
  };
  return labels[status];
}

function riskLabel(s: AdminStrings, level: RiskLevel): string {
  const labels: Record<RiskLevel, string> = {
    LOW: s.riskLow,
    MEDIUM: s.riskMedium,
    HIGH: s.riskHigh,
  };
  return labels[level];
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const meta = orderMeta[status];
  return (
    <Badge tone={meta.tone} icon={<Icon name={meta.icon} size={12} />}>
      {orderLabel(s, status)}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const meta = paymentMeta[status];
  return (
    <Badge tone={meta.tone} icon={<Icon name={meta.icon} size={12} />}>
      {paymentLabel(s, status)}
    </Badge>
  );
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const meta = riskMeta[level];
  return (
    <Badge tone={meta.tone} dot>
      {riskLabel(s, level)}
    </Badge>
  );
}
