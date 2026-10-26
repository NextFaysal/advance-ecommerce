/**
 * Shipments board read — doc 21 W0-C (G3-7a).
 *
 * The /admin/shipments page used to render TEMPORARY DEMO records from
 * page state. This is its real read: recent Shipment rows across all
 * orders (soft-deleted excluded), each with its order ref, its stored
 * charge/COD figures, and its real ShipmentEvent history (oldest
 * first — the rows the courier webhook / order-sync actually wrote;
 * nothing here is synthesized). The summary is computed over ALL
 * shipments (groupBy/aggregate), not just the returned page, so the
 * stat cards never understate; the page labels the row cap honestly.
 *
 * Read-only. Booking and status actions stay in the order workspace
 * (the shipments panel there) — this board is the cross-order view.
 *
 * Wave 54-2: each row also carries the warehouse pack state of its
 * order (`packed` / `packedPickListId`), read back from the
 * `warehouse-packed:<pickListId>` OrderNote markers via
 * getPackedMarkers — the page and the board API both serve it.
 */
import { prisma } from "@advance-ecommerce/db";
import { getPackedMarkers } from "@/warehouse/pick-lists";

export interface ShipmentBoardEvent {
  status: string;
  at: string;
}

export interface ShipmentBoardRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  provider: string;
  trackingId: string | null;
  status: string;
  codAmountPoisha: number;
  chargePoisha: number;
  weightGrams: number | null;
  /** Destination district from the order's address (display only). */
  district: string | null;
  /** Warehouse pack state for the row's order, read back from the
   *  `warehouse-packed:<pickListId>` OrderNote marker (wave 54-2) —
   *  the durable packed record, not a Shipment field. */
  packed: boolean;
  packedPickListId: string | null;
  createdAt: string;
  updatedAt: string;
  events: ShipmentBoardEvent[];
}

export interface ShipmentsBoardSummary {
  total: number;
  countsByStatus: Record<string, number>;
  inTransit: number;
  delivered: number;
  /** COD still to collect: sum over shipments not DELIVERED/RETURNED. */
  codOutstandingPoisha: number;
}

export interface ShipmentsBoardData {
  rows: ShipmentBoardRow[];
  summary: ShipmentsBoardSummary;
}

const IN_TRANSIT_STATUSES = ["PICKED_UP", "IN_TRANSIT", "OUT_FOR_DELIVERY"] as const;

export async function getShipmentsBoard(limit = 100): Promise<ShipmentsBoardData> {
  const [rows, total, statusGroups, codAgg] = await Promise.all([
    prisma.shipment.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        order: { select: { orderNo: true, status: true, district: true } },
        events: {
          orderBy: { createdAt: "asc" },
          select: { status: true, createdAt: true },
        },
      },
    }),
    prisma.shipment.count({ where: { deletedAt: null } }),
    prisma.shipment.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    prisma.shipment.aggregate({
      where: { deletedAt: null, status: { notIn: ["DELIVERED", "RETURNED"] } },
      _sum: { codAmountPoisha: true },
    }),
  ]);

  const countsByStatus: Record<string, number> = {};
  for (const g of statusGroups) countsByStatus[g.status] = g._count._all;

  // Packed markers for exactly the orders on this board page (the
  // marker read is an OrderNote scan keyed by order ids — no extra
  // sweep over orders the board does not show).
  const packedMarkers = await getPackedMarkers([...new Set(rows.map((r) => r.orderId))]);

  return {
    rows: rows.map((r) => {
      const marker = packedMarkers.get(r.orderId);
      return {
        id: r.id,
        orderId: r.orderId,
        orderNo: r.order.orderNo,
        orderStatus: r.order.status,
        provider: r.provider,
        trackingId: r.trackingId,
        status: r.status,
        codAmountPoisha: r.codAmountPoisha,
        chargePoisha: r.chargePoisha,
        weightGrams: r.weightGrams,
        district: r.order.district,
        packed: marker !== undefined,
        packedPickListId: marker?.pickListId ? marker.pickListId : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        events: r.events.map((e) => ({
          status: e.status,
          at: e.createdAt.toISOString(),
        })),
      };
    }),
    summary: {
      total,
      countsByStatus,
      inTransit: IN_TRANSIT_STATUSES.reduce((sum, s) => sum + (countsByStatus[s] ?? 0), 0),
      delivered: countsByStatus["DELIVERED"] ?? 0,
      codOutstandingPoisha: codAgg._sum.codAmountPoisha ?? 0,
    },
  };
}
