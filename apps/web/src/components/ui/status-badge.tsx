import { Badge } from "./badge";

/* Status is NEVER color-only: always color + icon + text. */
export type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED" | "RETURNED" | "REFUNDED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "FAILED" | "REFUNDED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

const orderMap: Record<OrderStatus, { label: string; icon: string; tone: "warning" | "info" | "brand" | "success" | "danger" | "neutral" }> = {
  PENDING: { label: "Pending", icon: "◷", tone: "warning" },
  CONFIRMED: { label: "Confirmed", icon: "✓", tone: "info" },
  PROCESSING: { label: "Processing", icon: "↻", tone: "brand" },
  PACKED: { label: "Packed", icon: "▣", tone: "brand" },
  SHIPPED: { label: "Shipped", icon: "▸", tone: "info" },
  DELIVERED: { label: "Delivered", icon: "✓✓", tone: "success" },
  CANCELLED: { label: "Cancelled", icon: "✕", tone: "neutral" },
  FAILED: { label: "Failed", icon: "⚠", tone: "danger" },
  RETURNED: { label: "Returned", icon: "↩", tone: "warning" },
  REFUNDED: { label: "Refunded", icon: "₩", tone: "info" },
};

const paymentMap: Record<PaymentStatus, { label: string; icon: string; tone: "warning" | "info" | "success" | "danger" }> = {
  UNPAID: { label: "Unpaid", icon: "◷", tone: "warning" },
  PARTIAL: { label: "Partial", icon: "◐", tone: "info" },
  PAID: { label: "Paid", icon: "✓", tone: "success" },
  FAILED: { label: "Failed", icon: "⚠", tone: "danger" },
  REFUNDED: { label: "Refunded", icon: "↩", tone: "info" },
};

const riskMap: Record<RiskLevel, { label: string; icon: string; tone: "success" | "warning" | "danger" }> = {
  LOW: { label: "Low risk", icon: "●", tone: "success" },
  MEDIUM: { label: "Medium risk", icon: "●", tone: "warning" },
  HIGH: { label: "High risk", icon: "●", tone: "danger" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = orderMap[status];
  return <Badge tone={s.tone}><span aria-hidden="true">{s.icon}</span> {s.label}</Badge>;
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const s = paymentMap[status];
  return <Badge tone={s.tone}><span aria-hidden="true">{s.icon}</span> {s.label}</Badge>;
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const s = riskMap[level];
  return <Badge tone={s.tone}><span aria-hidden="true">{s.icon}</span> {s.label}</Badge>;
}
