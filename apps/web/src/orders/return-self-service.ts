/**
 * Customer self-service returns — doc 17 batch O7 (part 2).
 *
 * The policy + read side of POST /api/v1/public/account/orders/[id]/returns
 * and GET /api/v1/public/account/returns. The WRITE itself goes
 * through the RMA core's shared createReturn (src/orders/returns.ts,
 * O7-1) with source "customer" — this module never writes Return rows.
 *
 * POLICY (Settings-driven, fails open like order-rules.ts):
 *   orders.returns.window_days   how long after delivery a customer
 *                                may apply online; default 7 days.
 * An order is eligible when it belongs to the signed-in customer
 * (order.customerId — the same ownership rule as reorder), its status
 * is DELIVERED, and it was delivered within the window.
 *
 * DELIVERED-AT: the Order row has no deliveredAt column. The delivery
 * instant is the OrderStatusHistory row that moved the order INTO
 * DELIVERED (applyOrderTransition writes one per move). Orders that
 * predate history rows fall back to Order.updatedAt while DELIVERED —
 * the fallback is reported in the result (deliveredAtSource) so no
 * surface has to pretend it is exact.
 *
 * Guests (phone-only orders, no account) cannot apply online — there
 * is deliberately no guest token flow; the account UI copy sends them
 * to the hotline instead.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "@/lib/settings";
import { loadReturnLines } from "./return-lines";
import { addQty, qtyNumber, subQty } from "../lib/quantity";

/* ------------------------------------------------------------------ */
/* Status vocabulary (both enum generations, labelled bilingually)     */
/* ------------------------------------------------------------------ */

export const RETURN_STATUS_LABELS: Record<string, { bn: string; en: string }> = {
  REQUESTED: { bn: "আবেদন গৃহীত হয়েছে", en: "Requested" },
  APPROVED: { bn: "অনুমোদিত", en: "Approved" },
  REJECTED: { bn: "প্রত্যাখ্যাত", en: "Rejected" },
  RECEIVED: { bn: "পণ্য ফেরত পৌঁছেছে", en: "Received" },
  COMPLETED: { bn: "সম্পন্ন", en: "Completed" },
  // Legacy enum values (pre-O7 schema) — labelled so older rows still
  // render honestly if any exist.
  RETURNING: { bn: "ফেরত পাঠানো হচ্ছে", en: "Returning" },
  RETURNED: { bn: "পণ্য ফেরত পৌঁছেছে", en: "Returned" },
  REFUNDED: { bn: "রিফান্ড সম্পন্ন", en: "Refunded" },
  EXCHANGED: { bn: "বদলি সম্পন্ন", en: "Exchanged" },
};

export function returnStatusLabel(status: string): { bn: string; en: string } {
  return RETURN_STATUS_LABELS[status] ?? { bn: status, en: status };
}

/* ------------------------------------------------------------------ */
/* Policy                                                              */
/* ------------------------------------------------------------------ */

export const DEFAULT_RETURN_WINDOW_DAYS = 7;

export async function loadReturnWindowDays(): Promise<number> {
  try {
    const raw = await getSetting("orders.returns.window_days");
    if (raw === null) return DEFAULT_RETURN_WINDOW_DAYS;
    const n = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(n) && n >= 1 && n <= 365 ? n : DEFAULT_RETURN_WINDOW_DAYS;
  } catch {
    return DEFAULT_RETURN_WINDOW_DAYS;
  }
}

/* ------------------------------------------------------------------ */
/* Delivery instant                                                    */
/* ------------------------------------------------------------------ */

export interface DeliveredAt {
  at: Date;
  /** "status_history" = exact transition instant; "updated_at" =
   *  fallback for orders with no history row (see file header). */
  source: "status_history" | "updated_at";
}

export async function getOrderDeliveredAt(orderId: string): Promise<DeliveredAt | null> {
  const history = await prisma.orderStatusHistory.findFirst({
    where: { orderId, to: "DELIVERED" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (history !== null) return { at: history.createdAt, source: "status_history" };
  const order = await prisma.order.findFirst({
    where: { id: orderId, deletedAt: null },
    select: { status: true, updatedAt: true },
  });
  if (order === null || order.status !== "DELIVERED") return null;
  return { at: order.updatedAt, source: "updated_at" };
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export interface ReturnableLine {
  orderItemId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  orderedQuantity: number;
  /** Quantity already claimed by this order's non-REJECTED returns. */
  alreadyRequestedQuantity: number;
  returnableQuantity: number;
}

export type ReturnEligibility =
  | {
      ok: true;
      orderId: string;
      orderNo: string;
      deliveredAt: string;
      deliveredAtSource: DeliveredAt["source"];
      windowDays: number;
      lines: ReturnableLine[];
    }
  | {
      ok: false;
      /** NOT_FOUND covers both missing and another customer's order —
       *  the route maps both to the same 404 (no enumeration). */
      code: "NOT_FOUND" | "ORDER_NOT_DELIVERED" | "RETURN_WINDOW_EXPIRED";
      message: string;
      windowDays?: number;
      deliveredAt?: string;
    };

export async function checkCustomerReturnEligibility(
  customerId: string,
  orderId: string,
  now: Date = new Date(),
): Promise<ReturnEligibility> {
  const windowDays = await loadReturnWindowDays();
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId, deletedAt: null },
    select: {
      id: true,
      orderNo: true,
      status: true,
      items: {
        select: { id: true, productName: true, sku: true, unitPricePoisha: true, quantity: true },
      },
    },
  });
  if (order === null) {
    return { ok: false, code: "NOT_FOUND", message: "অর্ডারটি পাওয়া যায়নি। / Order not found." };
  }
  if (order.status !== "DELIVERED") {
    return {
      ok: false,
      code: "ORDER_NOT_DELIVERED",
      message:
        "শুধু ডেলিভারি সম্পন্ন অর্ডারের জন্যই অনলাইনে রিটার্নের আবেদন করা যায়। / Returns can be requested online only for delivered orders.",
    };
  }
  const delivered = await getOrderDeliveredAt(order.id);
  if (delivered === null) {
    return { ok: false, code: "NOT_FOUND", message: "অর্ডারটি পাওয়া যায়নি। / Order not found." };
  }
  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  if (now.getTime() - delivered.at.getTime() > windowMs) {
    return {
      ok: false,
      code: "RETURN_WINDOW_EXPIRED",
      message: `ডেলিভারির ${windowDays} দিনের মধ্যে রিটার্নের আবেদন করতে হয় — এই অর্ডারের সময়সীমা শেষ হয়ে গেছে। সহায়তার জন্য আমাদের হটলাইনে কল করুন। / Returns must be requested within ${windowDays} days of delivery — this order's window has closed. Please call our hotline for help.`,
      windowDays,
      deliveredAt: delivered.at.toISOString(),
    };
  }

  // Quantities already claimed by this order's live returns, so the
  // form never offers more than what is actually returnable. The
  // REJECTED filter runs in JS (String() compare) so this file
  // compiles against either generation of the ReturnStatus enum.
  const priorReturns = (
    await prisma.return.findMany({
      where: { orderId: order.id, deletedAt: null },
      select: { id: true, status: true },
    })
  ).filter((r) => String(r.status) !== "REJECTED");
  const claimed = new Map<string, number>();
  for (const r of priorReturns) {
    for (const line of await loadReturnLines(r.id)) {
      claimed.set(line.orderItemId, addQty(claimed.get(line.orderItemId) ?? 0, line.quantity));
    }
  }

  return {
    ok: true,
    orderId: order.id,
    orderNo: order.orderNo,
    deliveredAt: delivered.at.toISOString(),
    deliveredAtSource: delivered.source,
    windowDays,
    lines: order.items.map((i) => {
      const already = claimed.get(i.id) ?? 0;
      return {
        orderItemId: i.id,
        productName: i.productName,
        sku: i.sku,
        unitPricePoisha: i.unitPricePoisha,
        orderedQuantity: qtyNumber(i.quantity),
        alreadyRequestedQuantity: already,
        returnableQuantity: Math.max(0, subQty(i.quantity, already)),
      };
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Own returns list                                                    */
/* ------------------------------------------------------------------ */

export interface CustomerReturnView {
  id: string;
  orderId: string;
  orderNo: string;
  status: string;
  statusLabel: { bn: string; en: string };
  reason: string | null;
  createdAt: string;
  lines: { productName: string; sku: string; quantity: number; unitPricePoisha: number }[];
}

/** The signed-in customer's returns, newest first — the
 *  customer-visible status surface notifyReturnStatus refers to. */
export async function listCustomerReturns(customerId: string): Promise<CustomerReturnView[]> {
  const rows = await prisma.return.findMany({
    where: { deletedAt: null, order: { customerId, deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      orderId: true,
      status: true,
      reason: true,
      createdAt: true,
      order: { select: { orderNo: true } },
    },
  });
  const views: CustomerReturnView[] = [];
  for (const row of rows) {
    const lines = await loadReturnLines(row.id);
    views.push({
      id: row.id,
      orderId: row.orderId,
      orderNo: row.order.orderNo,
      status: row.status,
      statusLabel: returnStatusLabel(row.status),
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      lines: lines.map((l) => ({
        productName: l.productName,
        sku: l.sku,
        quantity: l.quantity,
        unitPricePoisha: l.unitPricePoisha,
      })),
    });
  }
  return views;
}
