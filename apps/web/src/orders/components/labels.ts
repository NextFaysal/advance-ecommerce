// Bangla labels for order statuses — shared by the Order Workspace components.
// Display only; the state machine (src/orders/state-machine.ts) stays the
// single source of truth for which transitions are allowed.
import type { OrderStatus } from "../types";

export const ORDER_STATUS_BN: Record<OrderStatus, string> = {
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
