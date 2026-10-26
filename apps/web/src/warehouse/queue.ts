/**
 * Warehouse pick queue — ADV-21 (doc 22).
 *
 * The queue is the live set of CONFIRMED orders waiting to be
 * picked, oldest first (warehouse FIFO). Each row is decorated with
 * two facts from the warehouse's own records: whether the order
 * already sits on an OPEN pick list, and whether a pack-completion
 * marker exists on its timeline.
 *
 * "আজকের সব কনফার্মড" (today's confirmed) keys on the CONFIRMED
 * transition instant from OrderStatusHistory, in Asia/Dhaka days.
 * Orders with no CONFIRMED history row (older/imported data) fall
 * back to their createdAt — the fallback is part of the returned
 * row (confirmedAtSource) so the UI never presents it as exact.
 */
import {
  getPackedMarkers,
  openPickListByOrder,
  prismaKeyValueStore,
  type KeyValueStore,
} from "./pick-lists";

/** YYYY-MM-DD of an instant in Asia/Dhaka. */
export function dhakaDayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function dhakaTodayKey(now: Date = new Date()): string {
  return dhakaDayKey(now.toISOString());
}

export interface ConfirmedQueueRow {
  orderId: string;
  orderNo: string;
  customerName: string;
  district: string;
  itemCount: number;
  totalQuantity: number;
  totalPoisha: number;
  createdAt: string;
  /** When the order entered CONFIRMED (history, else createdAt). */
  confirmedAt: string;
  confirmedAtSource: "history" | "created_at_fallback";
  /** Id of the OPEN pick list holding this order, if any. */
  openPickListId: string | null;
  /** Pick list id from the pack-completion timeline marker, if any. */
  packedPickListId: string | null;
}

export interface ConfirmedQueue {
  rows: ConfirmedQueueRow[];
  /** Ids in `rows` whose confirmed day is today (Dhaka) — the
   *  "আজকের সব কনফার্মড" selection. */
  todayOrderIds: string[];
}

export async function getConfirmedQueue(
  store: KeyValueStore = prismaKeyValueStore(),
  limit = 100,
  now: Date = new Date(),
): Promise<ConfirmedQueue> {
  const { prisma } = await import("@advance-ecommerce/db");
  const orders = await prisma.order.findMany({
    where: { status: "CONFIRMED", deletedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: { items: { select: { id: true, quantity: true } } },
  });
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return { rows: [], todayOrderIds: [] };

  const [history, openByOrder, packed] = await Promise.all([
    prisma.orderStatusHistory.findMany({
      where: { orderId: { in: orderIds }, to: "CONFIRMED" },
      orderBy: { createdAt: "desc" },
      select: { orderId: true, createdAt: true },
    }),
    openPickListByOrder(store),
    getPackedMarkers(orderIds),
  ]);

  const confirmedAtByOrder = new Map<string, string>();
  for (const h of history) {
    if (!confirmedAtByOrder.has(h.orderId)) {
      confirmedAtByOrder.set(h.orderId, h.createdAt.toISOString());
    }
  }

  const today = dhakaTodayKey(now);
  const rows: ConfirmedQueueRow[] = orders.map((o) => {
    const fromHistory = confirmedAtByOrder.get(o.id);
    const confirmedAt = fromHistory ?? o.createdAt.toISOString();
    return {
      orderId: o.id,
      orderNo: o.orderNo,
      customerName: o.customerName,
      district: o.district,
      itemCount: o.items.length,
      totalQuantity: o.items.reduce((sum, i) => sum + i.quantity, 0),
      totalPoisha: o.totalPoisha,
      createdAt: o.createdAt.toISOString(),
      confirmedAt,
      confirmedAtSource: fromHistory ? "history" : "created_at_fallback",
      openPickListId: openByOrder.get(o.id) ?? null,
      packedPickListId: packed.get(o.id)?.pickListId ?? null,
    };
  });
  return {
    rows,
    todayOrderIds: rows.filter((r) => dhakaDayKey(r.confirmedAt) === today).map((r) => r.orderId),
  };
}
