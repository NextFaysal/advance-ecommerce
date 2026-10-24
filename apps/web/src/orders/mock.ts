// TEMPORARY MOCK DATA — Agent 4 only, for UI shells until the DB/API is wired.
// Delete this file (or replace its imports with real queries) when the API
// owner wires /api/v1/admin/orders, /customers and /api/v1/public/orders.
// No mock value here is real customer data; phones are illustrative only.
import type { Customer, Order } from "./types";

export const MOCK_ORDERS: Order[] = [
  {
    id: "ord-1",
    orderNo: "ORD-100245",
    customerName: "Rahim Uddin",
    customerPhone: "+8801712345678",
    address: {
      division: "Dhaka",
      district: "Dhaka",
      upazila: "Dhanmondi",
      addressLine: "House 12, Road 5, Dhanmondi",
    },
    items: [
      {
        variantId: "var-1",
        productName: "Cotton Panjabi",
        sku: "PNJ-BLK-M",
        unitPricePoisha: 149900,
        quantity: 1,
      },
      {
        variantId: "var-2",
        productName: "Cotton Panjabi",
        sku: "PNJ-WHT-L",
        unitPricePoisha: 149900,
        quantity: 1,
      },
    ],
    totalPoisha: 305800,
    paymentMethod: "cod",
    paymentStatus: "UNPAID",
    status: "PENDING",
    courier: "Steadfast",
    riskScore: 18,
    tags: ["new"],
    history: [
      { from: null, to: "PENDING", changedBy: "system", changedAt: "2026-10-24T06:00:00.000Z" },
    ],
    notes: [],
    createdAt: "2026-10-24T06:00:00.000Z",
  },
  {
    id: "ord-2",
    orderNo: "ORD-100244",
    customerName: "Nusrat Jahan",
    customerPhone: "+8801834567890",
    address: {
      division: "Chattogram",
      district: "Chattogram",
      upazila: "Panchlaish",
      addressLine: "Flat 3B, GEC Circle",
    },
    items: [
      {
        variantId: "var-3",
        productName: "Three Piece",
        sku: "TP-RED-M",
        unitPricePoisha: 219900,
        quantity: 1,
      },
    ],
    totalPoisha: 231900,
    paymentMethod: "bkash",
    paymentStatus: "PAID",
    status: "SHIPPED",
    courier: "Pathao",
    trackingId: "PX-778899",
    riskScore: 62,
    tags: ["repeat"],
    history: [
      { from: null, to: "PENDING", changedBy: "system", changedAt: "2026-10-23T06:00:00.000Z" },
      { from: "PENDING", to: "CONFIRMED", changedBy: "staff-1", changedAt: "2026-10-23T07:00:00.000Z" },
      { from: "CONFIRMED", to: "PROCESSING", changedBy: "staff-1", changedAt: "2026-10-23T09:00:00.000Z" },
      { from: "PROCESSING", to: "PACKED", changedBy: "staff-1", changedAt: "2026-10-23T12:00:00.000Z" },
      { from: "PACKED", to: "SHIPPED", changedBy: "staff-1", changedAt: "2026-10-23T15:00:00.000Z" },
    ],
    notes: [{ id: "n1", author: "staff-1", text: "Customer asked for evening delivery.", createdAt: "2026-10-23T08:00:00.000Z" }],
    createdAt: "2026-10-23T06:00:00.000Z",
  },
];

export const MOCK_CUSTOMERS: Customer[] = [
  {
    id: "cus-1",
    name: "Rahim Uddin",
    phone: "+8801712345678",
    totalOrders: 4,
    deliveredOrders: 3,
    cancelledOrders: 1,
    returnedOrders: 0,
    lifetimeValuePoisha: 912400,
    lastOrderAt: "2026-10-24T06:00:00.000Z",
    tags: ["repeat"],
    blocked: false,
  },
  {
    id: "cus-2",
    name: "Nusrat Jahan",
    phone: "+8801834567890",
    totalOrders: 9,
    deliveredOrders: 8,
    cancelledOrders: 0,
    returnedOrders: 1,
    lifetimeValuePoisha: 1845000,
    lastOrderAt: "2026-10-23T06:00:00.000Z",
    tags: ["vip"],
    blocked: false,
  },
];

export function findMockOrder(id: string): Order | undefined {
  return MOCK_ORDERS.find((o) => o.id === id || o.orderNo === id);
}
