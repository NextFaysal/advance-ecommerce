/**
 * Kitchen tickets — ADV-23 vertical 1 (doc 23, wave 56).
 *
 * The order-create seam + the KDS read/advance service over the
 * KitchenTicket table (one row per restaurant order, written INSIDE
 * the order-create transaction by src/orders/repository.ts — callers
 * here only VALIDATE and hand the spec over; see prepareKitchenTicket).
 *
 * Create-path contract (both seams — the public orders route and
 * createManualOrder — run the identical two steps):
 *   payload has no `restaurant` field -> null; nothing changes.
 *   field present + flag OFF          -> 403 FEATURE_LOCKED (a locked
 *                                        module never runs open — the
 *                                        portal/subscriptions precedent).
 *   field present + flag ON           -> validate against the
 *                                        effective restaurant.config;
 *                                        a violation is a 400 with the
 *                                        bilingual validator message.
 */
import { prisma } from "@advance-ecommerce/db";
import { qtyNumber, qtyToString } from "@/lib/quantity";
import { loadRestaurantConfig } from "./config";
import { isRestaurantEnabled } from "./flags";
import {
  KITCHEN_NEXT_STATUS,
  validateRestaurantSelection,
  type KitchenTicketSpec,
  type KitchenTicketStatus,
  type RestaurantSelection,
} from "./selection";

export type PrepareKitchenTicketResult =
  | { ok: true; ticket: KitchenTicketSpec | null }
  | { ok: false; httpStatus: 403 | 400; code: string; message: string };

/**
 * The shared create-seam gate. Returns ticket=null when the payload
 * carried no restaurant selection (the default path — byte-identical
 * behaviour for every non-restaurant order).
 */
export async function prepareKitchenTicket(
  selection: RestaurantSelection | undefined,
): Promise<PrepareKitchenTicketResult> {
  if (selection === undefined) return { ok: true, ticket: null };
  if (!isRestaurantEnabled()) {
    return {
      ok: false,
      httpStatus: 403,
      code: "FEATURE_LOCKED",
      message:
        "রেস্টুরেন্ট মডিউল এই ইনস্টলে বন্ধ আছে। / The restaurant module is locked for this install (module.restaurant is OFF).",
    };
  }
  const { effective } = await loadRestaurantConfig();
  const validated = validateRestaurantSelection(selection, effective);
  if (!validated.ok) {
    return { ok: false, httpStatus: 400, code: validated.code, message: validated.message };
  }
  return { ok: true, ticket: validated.ticket };
}

/**
 * Cancellation seam — called from applyOrderTransition's CANCELLED
 * block (and saveOrder's bulk funnel) with the pickup-OTP discipline:
 * NEVER throws, no-ops when there is no ticket or the ticket is
 * already final (SERVED / CANCELLED). A kitchen must never keep
 * cooking an order that no longer exists.
 */
export async function cancelKitchenTicketForOrder(orderId: string): Promise<void> {
  try {
    await prisma.kitchenTicket.updateMany({
      where: { orderId, status: { in: ["QUEUED", "PREPARING", "READY"] } },
      data: { status: "CANCELLED" },
    });
  } catch (err) {
    console.error(`[restaurant] kitchen ticket cancel failed for order ${orderId}:`, err);
  }
}

/** The customer-facing projection for the public tracking view:
 *  status + fulfilment + table only — nothing else about the order
 *  or the kitchen leaks through this seam. */
export interface KitchenTicketView {
  status: KitchenTicketStatus;
  fulfilmentType: "DINE_IN" | "TAKEAWAY";
  tableLabel: string | null;
}

export async function getKitchenTicketView(orderId: string): Promise<KitchenTicketView | null> {
  try {
    const row = await prisma.kitchenTicket.findUnique({
      where: { orderId },
      select: { status: true, fulfilmentType: true, tableLabel: true },
    });
    if (!row) return null;
    return {
      status: row.status as KitchenTicketStatus,
      fulfilmentType: row.fulfilmentType as "DINE_IN" | "TAKEAWAY",
      tableLabel: row.tableLabel,
    };
  } catch {
    // Tracking must never fail because the kitchen read did.
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* KDS board                                                           */
/* ------------------------------------------------------------------ */

export interface KitchenBoardItem {
  productName: string;
  sku: string;
  /** Canonical display string (wave-59 quantity discipline). */
  quantity: string;
  quantityNumber: number;
}

export interface KitchenBoardTicket {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  fulfilmentType: "DINE_IN" | "TAKEAWAY";
  tableLabel: string | null;
  status: KitchenTicketStatus;
  createdAt: string;
  readyAt: string | null;
  items: KitchenBoardItem[];
}

export interface KitchenBoard {
  /** Live tickets (QUEUED / PREPARING / READY), oldest first — the
   *  kitchen works a queue, not a feed. */
  tickets: KitchenBoardTicket[];
  /** Tickets SERVED on the current Asia/Dhaka day. */
  servedTodayCount: number;
  /** Tickets CANCELLED on the current Asia/Dhaka day (orders that
   *  were cancelled after reaching the kitchen). */
  cancelledTodayCount: number;
}

function dhakaDayStart(now: Date): Date {
  // Asia/Dhaka is UTC+6 year-round (no DST): the Dhaka day starts at
  // 18:00 UTC of the previous UTC day.
  const dhaka = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  dhaka.setUTCHours(0, 0, 0, 0);
  return new Date(dhaka.getTime() - 6 * 60 * 60 * 1000);
}

export async function getKitchenBoard(now: Date = new Date()): Promise<KitchenBoard> {
  const dayStart = dhakaDayStart(now);
  const [live, servedTodayCount, cancelledTodayCount] = await Promise.all([
    prisma.kitchenTicket.findMany({
      where: { status: { in: ["QUEUED", "PREPARING", "READY"] } },
      orderBy: { createdAt: "asc" },
      take: 200,
      include: {
        order: {
          select: {
            id: true,
            orderNo: true,
            status: true,
            items: {
              select: { productName: true, sku: true, quantity: true },
              orderBy: { createdAt: "asc" },
            },
          },
        },
      },
    }),
    prisma.kitchenTicket.count({ where: { status: "SERVED", updatedAt: { gte: dayStart } } }),
    prisma.kitchenTicket.count({ where: { status: "CANCELLED", updatedAt: { gte: dayStart } } }),
  ]);
  return {
    tickets: live.map((t) => ({
      id: t.id,
      orderId: t.order.id,
      orderNo: t.order.orderNo,
      orderStatus: t.order.status,
      fulfilmentType: t.fulfilmentType as "DINE_IN" | "TAKEAWAY",
      tableLabel: t.tableLabel,
      status: t.status as KitchenTicketStatus,
      createdAt: t.createdAt.toISOString(),
      readyAt: t.readyAt ? t.readyAt.toISOString() : null,
      items: t.order.items.map((i) => ({
        productName: i.productName,
        sku: i.sku,
        quantity: qtyToString(i.quantity),
        quantityNumber: qtyNumber(i.quantity),
      })),
    })),
    servedTodayCount,
    cancelledTodayCount,
  };
}

export type AdvanceKitchenTicketResult =
  | { ok: true; ticket: { id: string; status: KitchenTicketStatus; readyAt: string | null } }
  | { ok: false; httpStatus: 404 | 409; code: string; message: string };

/**
 * Advance a ticket ONE step along QUEUED -> PREPARING -> READY ->
 * SERVED. The caller names the TARGET status; anything that is not
 * exactly the next step (skips, backwards, re-advance of a final
 * ticket, board-side CANCELLED) is a 409 — the kitchen flow is a
 * conveyor, and a stale board must never silently rewind it.
 * readyAt is stamped on the move INTO READY.
 */
export async function advanceKitchenTicket(
  ticketId: string,
  to: string,
): Promise<AdvanceKitchenTicketResult> {
  const row = await prisma.kitchenTicket.findUnique({
    where: { id: ticketId },
    select: { id: true, status: true, readyAt: true },
  });
  if (!row) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "Kitchen ticket not found." };
  }
  const current = row.status as KitchenTicketStatus;
  const expected = KITCHEN_NEXT_STATUS[current];
  if (!expected || to !== expected) {
    return {
      ok: false,
      httpStatus: 409,
      code: "INVALID_TRANSITION",
      message: `টিকিটটি ${current} থেকে ${to}-তে নেওয়া যাবে না${expected ? ` — পরের ধাপ ${expected}` : ""}। / Ticket cannot move from ${current} to ${to}${expected ? ` — the next step is ${expected}` : " (final state)"}.`,
    };
  }
  const updated = await prisma.kitchenTicket.update({
    where: { id: ticketId },
    data: {
      status: expected,
      ...(expected === "READY" ? { readyAt: new Date() } : {}),
    },
    select: { id: true, status: true, readyAt: true },
  });
  return {
    ok: true,
    ticket: {
      id: updated.id,
      status: updated.status as KitchenTicketStatus,
      readyAt: updated.readyAt ? updated.readyAt.toISOString() : null,
    },
  };
}
