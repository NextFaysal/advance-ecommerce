/**
 * Ship scan — ADV-21 (doc 22).
 *
 * One code in (tracking id, shipment id, or order number) → the
 * shipment it belongs to, its packed state, and the one ship action
 * the warehouse performs here: recording that the parcel was handed
 * to the courier.
 *
 * HONESTY RULES:
 *  - Booking is NOT reimplemented. An order with no shipment yet
 *    resolves to state "not_booked" and links staff to the order
 *    workspace, where the booking panel lives.
 *  - A manual handover is NOT a courier event. The courier event
 *    funnel (src/courier/order-sync.ts) consumes PROVIDER events;
 *    feeding it a staff attestation would fabricate provider state.
 *    So handover writes exactly one order timeline note —
 *    "কুরিয়ারে হস্তান্তর (ম্যানুয়াল)" with the marker token below —
 *    and nothing more. The order's SHIPPED transition still arrives
 *    through the real courier sync when the provider reports
 *    pickup. The UI labels the action manual everywhere.
 */
import { addOrderTimelineNote } from "@/shipments/split-shipments";
import { WarehouseError, getPackedMarkers, type WarehouseActor } from "./pick-lists";

/** Marker token in the handover timeline note: `warehouse-handover:<shipmentId>`. */
export const HANDOVER_NOTE_MARKER = "warehouse-handover:";

export interface ScanOrderView {
  orderId: string;
  orderNo: string;
  orderStatus: string;
  customerName: string;
  district: string;
}

export interface ScanShipmentView {
  shipmentId: string;
  provider: string;
  trackingId: string | null;
  status: string;
  codAmountPoisha: number;
  chargePoisha: number;
  createdAt: string;
  /** Manual handover already recorded for this shipment. */
  handoverAt: string | null;
  /** True only when the parcel is booked (CREATED) and no manual
   *  handover note exists yet — the only state the handover action
   *  accepts. */
  canHandover: boolean;
  /** Pick list id from the order's pack-completion marker, if any. */
  packedPickListId: string | null;
}

export type ScanResolution =
  | { state: "found"; order: ScanOrderView; shipment: ScanShipmentView }
  | { state: "not_booked"; order: ScanOrderView; workspacePath: string }
  | { state: "not_found"; code: string };

interface ShipmentRow {
  id: string;
  orderId: string;
  provider: string;
  trackingId: string | null;
  status: string;
  codAmountPoisha: number;
  chargePoisha: number;
  createdAt: Date;
}

async function handoverAtFor(orderId: string, shipmentId: string): Promise<string | null> {
  const { prisma } = await import("@advance-ecommerce/db");
  const note = await prisma.orderNote.findFirst({
    where: { orderId, text: { contains: `${HANDOVER_NOTE_MARKER}${shipmentId}` } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  return note?.createdAt.toISOString() ?? null;
}

async function toFound(row: ShipmentRow): Promise<ScanResolution> {
  const { prisma } = await import("@advance-ecommerce/db");
  const order = await prisma.order.findFirst({
    where: { id: row.orderId, deletedAt: null },
    select: { id: true, orderNo: true, status: true, customerName: true, district: true },
  });
  if (!order) return { state: "not_found", code: row.id };
  const [handoverAt, packed] = await Promise.all([
    handoverAtFor(order.id, row.id),
    getPackedMarkers([order.id]),
  ]);
  return {
    state: "found",
    order: {
      orderId: order.id,
      orderNo: order.orderNo,
      orderStatus: order.status,
      customerName: order.customerName,
      district: order.district,
    },
    shipment: {
      shipmentId: row.id,
      provider: row.provider,
      trackingId: row.trackingId,
      status: row.status,
      codAmountPoisha: row.codAmountPoisha,
      chargePoisha: row.chargePoisha,
      createdAt: row.createdAt.toISOString(),
      handoverAt,
      canHandover: row.status === "CREATED" && handoverAt === null,
      packedPickListId: packed.get(order.id)?.pickListId ?? null,
    },
  };
}

/**
 * Resolve a scanned/typed code. Tries, in order: shipment tracking
 * id (exact), shipment id, order number. An order number with no
 * shipment yet is a successful resolution ("not_booked") — staff
 * get sent to the booking panel instead of an error.
 */
export async function resolveScanCode(rawCode: string): Promise<ScanResolution> {
  const code = rawCode.trim();
  if (!code) {
    throw new WarehouseError("EMPTY_CODE", "একটি ট্র্যাকিং কোড বা অর্ডার নম্বর দিন।", 400);
  }
  const { prisma } = await import("@advance-ecommerce/db");

  const byTracking = (await prisma.shipment.findFirst({
    where: { trackingId: code, deletedAt: null },
  })) as ShipmentRow | null;
  if (byTracking) return toFound(byTracking);

  const byId = (await prisma.shipment.findFirst({
    where: { id: code, deletedAt: null },
  })) as ShipmentRow | null;
  if (byId) return toFound(byId);

  const order = await prisma.order.findFirst({
    where: { orderNo: code, deletedAt: null },
    select: { id: true, orderNo: true, status: true, customerName: true, district: true },
  });
  if (order) {
    const shipment = (await prisma.shipment.findFirst({
      where: { orderId: order.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
    })) as ShipmentRow | null;
    if (shipment) return toFound(shipment);
    return {
      state: "not_booked",
      order: {
        orderId: order.id,
        orderNo: order.orderNo,
        orderStatus: order.status,
        customerName: order.customerName,
        district: order.district,
      },
      workspacePath: `/admin/orders/${order.id}`,
    };
  }
  return { state: "not_found", code };
}

/** The timeline note text for a manual handover. */
export function buildHandoverNoteText(
  shipment: { provider: string; trackingId: string | null; id: string },
  actor: WarehouseActor,
): string {
  const who = actor.name ? ` — ${actor.name}` : "";
  const tracking = shipment.trackingId ? ` · ট্র্যাকিং ${shipment.trackingId}` : "";
  return `কুরিয়ারে হস্তান্তর (ম্যানুয়াল) — ${shipment.provider}${tracking}${who} · ${HANDOVER_NOTE_MARKER}${shipment.id}`;
}

export interface HandoverResult {
  recorded: boolean;
  /** True when a handover note already existed — nothing re-written. */
  alreadyRecorded: boolean;
  shipmentId: string;
}

/**
 * Record a manual courier handover: exactly one timeline note on
 * the order, and nothing else (see header). Accepted only while the
 * shipment is CREATED (booked, not yet picked up). A shipment the
 * provider already reports as picked up (or beyond) refuses — its
 * real state came from the courier funnel, and a manual note would
 * only muddy it.
 */
export async function recordManualHandover(
  shipmentId: string,
  actor: WarehouseActor,
  noteWriter: (orderId: string, text: string) => Promise<void> = addOrderTimelineNote,
): Promise<HandoverResult> {
  const { prisma } = await import("@advance-ecommerce/db");
  const shipment = (await prisma.shipment.findFirst({
    where: { id: shipmentId, deletedAt: null },
  })) as ShipmentRow | null;
  if (!shipment) {
    throw new WarehouseError("SHIPMENT_NOT_FOUND", "শিপমেন্ট পাওয়া যায়নি।", 404);
  }
  const existing = await handoverAtFor(shipment.orderId, shipment.id);
  if (existing) return { recorded: false, alreadyRecorded: true, shipmentId: shipment.id };
  if (shipment.status !== "CREATED") {
    throw new WarehouseError(
      "ALREADY_HANDED_OVER",
      "এই শিপমেন্ট ইতিমধ্যে কুরিয়ারের পথে (স্ট্যাটাস: " + shipment.status + ") — ম্যানুয়াল হস্তান্তর লাগবে না।",
      409,
    );
  }
  await noteWriter(shipment.orderId, buildHandoverNoteText(shipment, actor));
  return { recorded: true, alreadyRecorded: false, shipmentId: shipment.id };
}
