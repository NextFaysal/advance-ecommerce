// Order domain types — Agent 4. Money in integer poisha, never float.
import type { BdAddress } from "../checkout/validation";

export type OrderStatus =
  | "INCOMPLETE"
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
  | "shurjopay"
  // Wave 49 (ADV-4 remainder): Rocket (manual TrxID verification) and
  // Upay (gateway) joined the checkout enum; the Prisma PaymentMethod
  // enum already carries ROCKET/UPAY.
  | "rocket"
  | "upay";

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
  /** Owning Customer row id (Order.customerId). Populated by the
   *  repository mapper from the order's customer relation; optional
   *  because client-side fixtures may not carry it. */
  customerId?: string;
  /** Create channel recorded on the row (Order.source): "website" for
   *  public checkout, "manual" for staff-created orders. */
  source?: string;
  /** Reseller attribution (Order.resellerId): set when the order is
   *  recorded as a reseller sale. The delivered-order hook credits
   *  this reseller's wallet (commission + margin) on DELIVERED. */
  resellerId?: string;
  customerName: string;
  /** Normalized +8801XXXXXXXXX. Display must be masked unless the viewer has customers.view_full_phone. */
  customerPhone: string;
  address: BdAddress;
  items: OrderItem[];
  totalPoisha: number;
  /** Money split (doc 18, F1) — persisted Order columns exposed by the
   *  repository mapper so consumers can render the real lines instead
   *  of a net figure: the invoice print centre shows ডেলিভারি চার্জ /
   *  ছাড় separately when these are present and falls back to its old
   *  net line when a payload predates them. Optional because client
   *  fixtures predate them. */
  shippingPoisha?: number;
  discountPoisha?: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  courier?: string;
  trackingId?: string;
  riskScore: number; // 0-100
  /** Advance payment engine (wave 21, doc 17 O3) — persisted Order
   *  columns, populated by the repository mapper. advanceRequiredPoisha
   *  is the amount that must be paid before PENDING -> CONFIRMED;
   *  advanceSatisfiedAt is stamped by markOrderPayment. requiresOtp /
   *  otpVerifiedAt are the OTP gate columns (the OTP service itself is
   *  O3-2; this batch persists the create-time flag and reads them in
   *  the confirm gate). Optional because client fixtures predate them. */
  advanceRequiredPoisha?: number;
  advanceReason?: string | null;
  advanceSatisfiedAt?: string | null;
  requiresOtp?: boolean;
  otpVerifiedAt?: string | null;
  /** Delivery slot + gift (wave 27, doc 17 batch O9-2) — persisted
   *  Order columns, populated by the repository mapper. deliverySlot
   *  is the slot ID from Settings orders.delivery_slots (labels are
   *  display-time, resolved from the setting); giftMessage is the
   *  verbatim message — null/absent = no gift, "" = gift requested
   *  with no message. Optional because client fixtures predate them. */
  deliverySlot?: string | null;
  giftMessage?: string | null;
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
