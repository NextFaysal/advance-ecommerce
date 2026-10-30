/**
 * /track UI strings — doc 30 unified language system, slice L3d.
 *
 * Slice-local dictionary following the core contract: the `bn` object
 * is written once (NOT `as const`), `en` is typed with the mapped type
 * so a missing/extra key fails compilation (parity guarantee).
 *
 * The tracking API view (src/storefront-ux/order-tracking.ts) carries
 * Bangla-only labels (`labelBn` / `statusLabelBn`) alongside the raw
 * status CODES. In Bangla mode the form renders the server labels (the
 * canonical wording); in English mode it translates from the status
 * code via the ORDER_STATUS / SHIPMENT_STATUS / KITCHEN_STATUS maps
 * below, falling back to the server label when a code is unknown.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  pageTitle: "অর্ডার ট্র্যাক করুন",
  pageIntro: "অর্ডার নম্বর ও অর্ডারের সময় দেওয়া মোবাইল নম্বর দিন।",
  metaTitle: "অর্ডার ট্র্যাকিং — Advance Ecommerce",
  metaDescription: "অর্ডার নম্বর ও মোবাইল নম্বর দিয়ে আপনার অর্ডারের অবস্থা দেখুন।",
  orderNoLabel: "অর্ডার নম্বর",
  phoneLabel: "মোবাইল নম্বর (অর্ডারের সময় দেওয়া)",
  submitIdle: "অর্ডার ট্র্যাক করুন",
  submitBusy: "খুঁজছি…",
  rateLimitNote: "নিরাপত্তার জন্য অল্প সময়ের মধ্যে বারবার চেষ্টা সীমিত রাখা হয়েছে।",
  notFoundFallback: "খুঁজে পাওয়া যায়নি।",
  networkError: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।",
  parcelStatusAria: "পার্সেলের অবস্থা",
  parcelPrefix: "পার্সেল",
  courierLabel: "কুরিয়ার",
  trackingNoLabel: "ট্র্যাকিং নম্বর",
  parcelItemsHeading: "এই পার্সেলে আছে:",
  phonePrefix: "ফোন",
  currentStageLabel: "বর্তমান ধাপ:",
  kitchenLabel: "রান্নাঘর:",
  dineIn: "ডাইন-ইন",
  tableLabel: "টেবিল",
  takeaway: "টেকঅওয়ে",
  shipmentTrackingLabel: "ট্র্যাকিং",
  noLiveCourierNote:
    "কুরিয়ারের লাইভ ট্র্যাকিং তথ্য এখনো এই অর্ডারে যুক্ত হয়নি — বুকিং হলে কুরিয়ারের নাম, ট্র্যাকিং নম্বর ও লাইভ অবস্থা এখানে দেখা যাবে। আপাতত অবস্থা অর্ডারের ধাপ অনুযায়ী দেখানো হচ্ছে।",
  itemsHeading: "পণ্য",
  totalLabel: "মোট",
  paymentLabel: "পেমেন্ট",
};

export type TrackStrings = { [K in keyof typeof bn]: string };

const en: TrackStrings = {
  pageTitle: "Track Your Order",
  pageIntro: "Enter your order number and the mobile number used for the order.",
  metaTitle: "Order Tracking — Advance Ecommerce",
  metaDescription: "See your order status with your order number and mobile number.",
  orderNoLabel: "Order Number",
  phoneLabel: "Mobile Number (used for the order)",
  submitIdle: "Track Order",
  submitBusy: "Searching…",
  rateLimitNote: "For security, repeated attempts within a short time are limited.",
  notFoundFallback: "Not found.",
  networkError: "Network problem — please try again.",
  parcelStatusAria: "Parcel status",
  parcelPrefix: "Parcel",
  courierLabel: "Courier",
  trackingNoLabel: "Tracking number",
  parcelItemsHeading: "In this parcel:",
  phonePrefix: "Phone",
  currentStageLabel: "Current stage:",
  kitchenLabel: "Kitchen:",
  dineIn: "Dine-in",
  tableLabel: "Table",
  takeaway: "Takeaway",
  shipmentTrackingLabel: "Tracking",
  noLiveCourierNote:
    "Live courier tracking is not attached to this order yet — once it is booked, the courier name, tracking number and live status will appear here. For now the status follows the order's steps.",
  itemsHeading: "Items",
  totalLabel: "Total",
  paymentLabel: "Payment",
};

export const TRACK_STRINGS: Record<Locale, TrackStrings> = { bn, en };

/* ------------------------------------------------------------------ */
/* Status-code label maps. Keys are the raw codes the API view        */
/* carries next to its Bangla labels (OrderStatus / ShipmentStatus /  */
/* KitchenTicketStatus). English values mirror the Bangla wording;    */
/* Bangla values mirror ORDER_STATUS_LABELS_BN /                       */
/* SHIPMENT_STATUS_LABELS_BN / KITCHEN_STATUS_LABELS_BN so both        */
/* locales render from one shape.                                      */
/* ------------------------------------------------------------------ */

const orderStatusBn = {
  INCOMPLETE: "অসম্পূর্ণ অর্ডার",
  PENDING: "অর্ডার পেয়েছি",
  CONFIRMED: "কনফার্ম হয়েছে",
  PROCESSING: "প্রসেসিং চলছে",
  PACKED: "প্যাক করা হয়েছে",
  SHIPPED: "পাঠানো হয়েছে",
  DELIVERED: "ডেলিভারি হয়েছে",
  FAILED: "ডেলিভারি ব্যর্থ হয়েছে",
  RETURN_REQUESTED: "রিটার্নের অনুরোধ এসেছে",
  RETURNING: "রিটার্ন ফেরত আসছে",
  RETURNED: "রিটার্ন পৌঁছেছে",
  CANCELLED: "বাতিল হয়েছে",
  REFUNDED: "রিফান্ড হয়েছে",
  EXCHANGED: "বদলি পাঠানো হয়েছে",
};

export type OrderStatusStrings = { [K in keyof typeof orderStatusBn]: string };

const orderStatusEn: OrderStatusStrings = {
  INCOMPLETE: "Incomplete order",
  PENDING: "Order received",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PACKED: "Packed",
  SHIPPED: "Shipped",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURN_REQUESTED: "Return requested",
  RETURNING: "Return on its way back",
  RETURNED: "Return received",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  EXCHANGED: "Exchange sent",
};

export const ORDER_STATUS_STRINGS: Record<Locale, OrderStatusStrings> = {
  bn: orderStatusBn,
  en: orderStatusEn,
};

const shipmentStatusBn = {
  CREATED: "কুরিয়ার বুকিং তৈরি হয়েছে",
  PICKED_UP: "কুরিয়ার পিক আপ করেছে",
  IN_TRANSIT: "পথে আছে",
  OUT_FOR_DELIVERY: "ডেলিভারির জন্য বের হয়েছে",
  DELIVERED: "ডেলিভারি হয়েছে",
  FAILED: "ডেলিভারি ব্যর্থ",
  RETURNING: "ফেরত আসছে",
  RETURNED: "ফেরত এসেছে",
};

export type ShipmentStatusStrings = { [K in keyof typeof shipmentStatusBn]: string };

const shipmentStatusEn: ShipmentStatusStrings = {
  CREATED: "Courier booking created",
  PICKED_UP: "Picked up by courier",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURNING: "Returning",
  RETURNED: "Returned",
};

export const SHIPMENT_STATUS_STRINGS: Record<Locale, ShipmentStatusStrings> = {
  bn: shipmentStatusBn,
  en: shipmentStatusEn,
};

/** Short parcel-stepper labels (subset of shipment statuses). */
const parcelStepBn = {
  CREATED: "তৈরি",
  PICKED_UP: "পিকআপ",
  IN_TRANSIT: "পথে",
  OUT_FOR_DELIVERY: "ডেলিভারিতে",
  DELIVERED: "ডেলিভার্ড",
  FAILED: "ডেলিভারি ব্যর্থ হয়েছে",
  RETURNING: "পার্সেলটি ফেরত আসছে",
  RETURNED: "পার্সেলটি ফেরত এসেছে",
};

export type ParcelStepStrings = { [K in keyof typeof parcelStepBn]: string };

const parcelStepEn: ParcelStepStrings = {
  CREATED: "Created",
  PICKED_UP: "Picked up",
  IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  FAILED: "Delivery failed",
  RETURNING: "Parcel is returning",
  RETURNED: "Parcel has been returned",
};

export const PARCEL_STEP_STRINGS: Record<Locale, ParcelStepStrings> = {
  bn: parcelStepBn,
  en: parcelStepEn,
};

const kitchenStatusBn = {
  QUEUED: "অপেক্ষমাণ",
  PREPARING: "তৈরি হচ্ছে",
  READY: "প্রস্তুত",
  SERVED: "পরিবেশন হয়েছে",
  CANCELLED: "বাতিল",
};

export type KitchenStatusStrings = { [K in keyof typeof kitchenStatusBn]: string };

const kitchenStatusEn: KitchenStatusStrings = {
  QUEUED: "Queued",
  PREPARING: "Preparing",
  READY: "Ready",
  SERVED: "Served",
  CANCELLED: "Cancelled",
};

export const KITCHEN_STATUS_STRINGS: Record<Locale, KitchenStatusStrings> = {
  bn: kitchenStatusBn,
  en: kitchenStatusEn,
};
