// Order domain types — Agent 4. Money in integer poisha, never float.
import type { BdAddress } from "../checkout/validation";

export type OrderStatus =
  | "PENDING"
  | "CONFIRMED"
  | "PROCESSING"
  | "PACKED"
  | "SHIPPED"
  | "DELIVERED"
  | "FAILED"
  | "RETURN_REQUESTED"
  | "RETURNING"
  | "RETURNED"
  | "CANCELLED"
  | "REFUNDED"
  | "EXCHANGED";

export type PaymentStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export type PaymentMethod =
  | "cod"
  | "bkash"
  | "nagad"
  // "card" added for the POS slice (Agent 54, D3 fix): a counter card sale
  // must not be labelled bkash/nagad on its receipt. Online checkout's Zod
  // enum in src/checkout/validation is a separate list and is unchanged.
  | "card"
  | "sslcommerz"
  | "aamarpay"
  | "shurjopay";

export type OrderItem = {
  variantId: string;
  productName: string;
  sku: string;
  /** Purchase-time snapshot price, integer poisha. */
  unitPricePoisha: number;
  quantity: number;
};

export type OrderStatusHistoryEntry = {
  from: OrderStatus | null;
  to: OrderStatus;
  changedBy: string;
  reason?: string;
  changedAt: string;
};

export type OrderNote = {
  id: string;
  author: string;
  text: string;
  createdAt: string;
};

export type Order = {
  id: string;
  orderNo: string;
  customerName: string;
  /** Normalized +8801XXXXXXXXX. Display must be masked unless the viewer has customers.view_full_phone. */
  customerPhone: string;
  address: BdAddress;
  items: OrderItem[];
  totalPoisha: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  courier?: string;
  trackingId?: string;
  riskScore: number; // 0-100
  tags: string[];
  assignee?: string;
  history: OrderStatusHistoryEntry[];
  notes: OrderNote[];
  createdAt: string;
};

export type Customer = {
  id: string;
  name: string;
  phone: string;
  email?: string;
  totalOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  returnedOrders: number;
  /** Lifetime value, integer poisha (delivered orders only). */
  lifetimeValuePoisha: number;
  lastOrderAt?: string;
  tags: string[];
  blocked: boolean;
};
