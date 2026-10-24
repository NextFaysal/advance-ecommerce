import { Badge } from "./badge";
import { Icon, type IconName } from "./icon";

/* Status is NEVER color-only: always color + icon + text. Icons are the
   v2 inline SVG set (icon.tsx), rendered at 12px inside the badge. */
export type OrderStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "FAILED" | "RETURNED" | "REFUNDED";
export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID" | "FAILED" | "REFUNDED";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

type Tone = "warning" | "info" | "brand" | "success" | "danger" | "neutral";

const orderMap: Record<OrderStatus, { label: string; icon: IconName; tone: Tone }> = {
  PENDING: { label: "Pending", icon: "clock", tone: "warning" },
  CONFIRMED: { label: "Confirmed", icon: "check", tone: "info" },
  PROCESSING: { label: "Processing", icon: "refresh-ccw", tone: "brand" },
  PACKED: { label: "Packed", icon: "package", tone: "brand" },
  SHIPPED: { label: "Shipped", icon: "truck", tone: "info" },
  DELIVERED: { label: "Delivered", icon: "check", tone: "success" },
  CANCELLED: { label: "Cancelled", icon: "x", tone: "neutral" },
  FAILED: { label: "Failed", icon: "alert", tone: "danger" },
  RETURNED: { label: "Returned", icon: "rotate-ccw", tone: "warning" },
  REFUNDED: { label: "Refunded", icon: "banknote", tone: "info" },
};

const paymentMap: Record<PaymentStatus, { label: string; icon: IconName; tone: Tone }> = {
  UNPAID: { label: "Unpaid", icon: "clock", tone: "warning" },
  PARTIAL: { label: "Partial", icon: "banknote", tone: "info" },
  PAID: { label: "Paid", icon: "check", tone: "success" },
  FAILED: { label: "Failed", icon: "alert", tone: "danger" },
  REFUNDED: { label: "Refunded", icon: "rotate-ccw", tone: "info" },
};

const riskMap: Record<RiskLevel, { label: string; tone: "success" | "warning" | "danger" }> = {
  LOW: { label: "Low risk", tone: "success" },
  MEDIUM: { label: "Medium risk", tone: "warning" },
  HIGH: { label: "High risk", tone: "danger" },
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = orderMap[status];
  return (
    <Badge tone={s.tone} icon={<Icon name={s.icon} size={12} />}>
      {s.label}
    </Badge>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const s = paymentMap[status];
  return (
    <Badge tone={s.tone} icon={<Icon name={s.icon} size={12} />}>
      {s.label}
    </Badge>
  );
}

export function RiskBadge({ level }: { level: RiskLevel }) {
  const s = riskMap[level];
  return (
    <Badge tone={s.tone} dot>
      {s.label}
    </Badge>
  );
}
