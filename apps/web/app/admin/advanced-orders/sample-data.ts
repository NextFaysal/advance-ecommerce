// SAMPLE demo data for the Advanced Orders admin page — Agent 43.
// TEMPORARY DEMO: every row here is fictional SAMPLE data shaped by the
// real types from src/advanced-orders and src/orders. Nothing on this page
// is persisted or submitted; all panels run the real pure functions from
// src/advanced-orders over this data in page state only.
import type { Order, OrderItem } from "@/orders/types";
import type {
  MergeCandidate, PartialPaymentState, PreOrder, WarehouseStock,
} from "@/advanced-orders";

const MIRPUR = {
  division: "Dhaka", district: "Dhaka", upazila: "Mirpur",
  addressLine: "House 12, Road 5, Mirpur 10",
};
const UTTARA = {
  division: "Dhaka", district: "Dhaka", upazila: "Uttara",
  addressLine: "House 3, Sector 11, Uttara",
};

export const SAMPLE_ITEMS: Record<string, OrderItem> = {
  shirt: {
    variantId: "var_sample_shirt_m", productName: "পাঞ্জাবি শার্ট (M)",
    sku: "SAMPLE-SHIRT-M", unitPricePoisha: 85000, quantity: 4,
  },
  shoe: {
    variantId: "var_sample_shoe_42", productName: "রানিং জুতা (42)",
    sku: "SAMPLE-SHOE-42", unitPricePoisha: 240000, quantity: 3,
  },
  bag: {
    variantId: "var_sample_bag_1", productName: "লেদার ব্যাগ",
    sku: "SAMPLE-BAG-01", unitPricePoisha: 180000, quantity: 3,
  },
  watch: {
    variantId: "var_sample_watch_1", productName: "স্মার্ট ওয়াচ",
    sku: "SAMPLE-WATCH-01", unitPricePoisha: 550000, quantity: 1,
  },
};

function itemsTotal(items: readonly OrderItem[]): number {
  return items.reduce((s, i) => s + i.unitPricePoisha * i.quantity, 0);
}

function makeOrder(partial: Pick<Order, "id" | "orderNo" | "customerPhone" | "status" | "address" | "items">): Order {
  return {
    customerName: "SAMPLE গ্রাহক",
    paymentMethod: "cod",
    paymentStatus: "PARTIAL",
    riskScore: 0,
    tags: ["SAMPLE"],
    history: [],
    notes: [],
    createdAt: "2026-10-24T09:00:00.000Z",
    ...partial,
    totalPoisha: itemsTotal(partial.items),
  };
}

/** Orders the split planner and the payment panel run against. */
export const SAMPLE_SPLIT_ORDERS: Order[] = [
  makeOrder({
    id: "ord_sample_2001", orderNo: "SAMPLE-2001",
    customerPhone: "+8801712345678", status: "CONFIRMED", address: MIRPUR,
    items: [SAMPLE_ITEMS.shirt, SAMPLE_ITEMS.shoe, SAMPLE_ITEMS.bag],
  }),
  makeOrder({
    id: "ord_sample_2002", orderNo: "SAMPLE-2002",
    customerPhone: "+8801912345678", status: "PENDING", address: UTTARA,
    items: [
      { ...SAMPLE_ITEMS.shirt, quantity: 2 },
      { ...SAMPLE_ITEMS.shoe, quantity: 1 },
    ],
  }),
];

/** Warehouse stock the allocation runs against (priority order matters). */
export const SAMPLE_WAREHOUSES: WarehouseStock[] = [
  {
    warehouseId: "wh_dhaka", warehouseName: "ঢাকা গুদাম (মিরপুর)", priority: 1,
    availableByVariant: {
      var_sample_shirt_m: 2, var_sample_shoe_42: 1, var_sample_bag_1: 0, var_sample_watch_1: 0,
    },
  },
  {
    warehouseId: "wh_ctg", warehouseName: "চট্টগ্রাম গুদাম", priority: 2,
    availableByVariant: {
      var_sample_shirt_m: 1, var_sample_shoe_42: 3, var_sample_bag_1: 2, var_sample_watch_1: 1,
    },
  },
];

/** Starting partial-payment state per split order (demo inputs). */
export const SAMPLE_PAYMENT_STATES: Record<string, PartialPaymentState> = {
  ord_sample_2001: { totalPoisha: SAMPLE_SPLIT_ORDERS[0].totalPoisha, paidPoisha: 500000, refundedPoisha: 0 },
  ord_sample_2002: { totalPoisha: SAMPLE_SPLIT_ORDERS[1].totalPoisha, paidPoisha: 0, refundedPoisha: 0 },
};

/** Merge candidates: A+B merge cleanly; A+C fail on phone + address + shipped. */
export const SAMPLE_MERGE_CANDIDATES: MergeCandidate[] = [
  {
    id: "ord_sample_3001", orderNo: "SAMPLE-3001", customerPhone: "+8801712345678",
    status: "PENDING", address: MIRPUR, totalPoisha: 250000,
  },
  {
    id: "ord_sample_3002", orderNo: "SAMPLE-3002", customerPhone: "+8801712345678",
    status: "CONFIRMED", address: MIRPUR, totalPoisha: 180000,
  },
  {
    id: "ord_sample_3003", orderNo: "SAMPLE-3003", customerPhone: "+8801812345678",
    status: "SHIPPED", address: UTTARA, totalPoisha: 320000,
  },
];

/** Extra SAMPLE pre-orders; the page also lists the shared demo store's row. */
export const SAMPLE_EXTRA_PREORDERS: PreOrder[] = [
  {
    id: "pre_sample_2", productVariantId: "var_sample_watch_1", sku: "SAMPLE-PRE-002",
    customerPhone: "+8801912345678", quantity: 5, unitPricePoisha: 180000,
    depositPoisha: 450000, expectedDate: "2026-11-20", status: "PARTIALLY_FULFILLED",
    fulfilledQty: 2, createdAt: "2026-10-22T00:00:00.000Z",
  },
  {
    id: "pre_sample_3", productVariantId: "var_sample_watch_1", sku: "SAMPLE-PRE-003",
    customerPhone: "+8801512345678", quantity: 1, unitPricePoisha: 550000,
    depositPoisha: 550000, expectedDate: "2026-10-30", status: "FULFILLED",
    fulfilledQty: 1, createdAt: "2026-10-20T00:00:00.000Z",
  },
];
