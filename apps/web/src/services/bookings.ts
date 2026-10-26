/**
 * Service bookings — ADV-23 vertical 2 (doc 23, wave 56).
 *
 * The order-create seam + the availability read + the admin board
 * service over the ServiceBooking table (one row per booked order,
 * written INSIDE the order-create transaction by
 * src/orders/repository.ts — callers here only VALIDATE and hand the
 * spec over; see prepareServiceBooking).
 *
 * Create-path contract (both seams — the public orders route and
 * createManualOrder — run the identical steps):
 *   payload has no `booking` field -> null; nothing changes.
 *   field present + flag OFF       -> 403 FEATURE_LOCKED (a locked
 *                                     module never runs open).
 *   field present + flag ON        -> validate against the stored
 *                                     services.config + the order's
 *                                     own items; a violation is a
 *                                     400 with the bilingual message.
 *   capacity                       -> counted INSIDE the create
 *                                     transaction by the repository
 *                                     (BOOKED rows conflicting with
 *                                     the slot, buffer included); a
 *                                     full slot aborts the create
 *                                     with ServiceBookingCapacityError
 *                                     (defined in src/orders/
 *                                     repository.ts) -> 409.
 *                                     Residual race, stated
 *                                     honestly: under Prisma's
 *                                     default ReadCommitted isolation
 *                                     two simultaneous creates can
 *                                     both pass the count in theory
 *                                     (write skew — Postgres has no
 *                                     unique partial index for
 *                                     "BOOKED rows per slot" to lean
 *                                     on). Single-tenant booking
 *                                     volume + the sub-second window
 *                                     keep it small; it is NOT zero.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { todayDhakaYmd } from "@/lib/dhaka-date";
import { loadServicesConfig } from "./config";
import { isServicesEnabled } from "./flags";
import {
  SERVICE_BOOKING_NEXT_STATUS,
  generateDaySlots,
  hhmmToMinutes,
  serviceDateInstant,
  serviceDateReason,
  slotConflicts,
  validateServiceBooking,
  type ServiceBookingSelection,
  type ServiceBookingStatus,
  type ServiceBookingWriteSpec,
  type ServiceDateReason,
} from "./selection";

/** "Now" on the Dhaka calendar: today's ymd + minutes since Dhaka
 *  midnight (for the today's-slots-are-past rule). */
export function dhakaNowParts(now: Date = new Date()): { todayYmd: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return { todayYmd: todayDhakaYmd(now), minutes: (hour % 24) * 60 + minute };
}

/* ------------------------------------------------------------------ */
/* Create seam                                                         */
/* ------------------------------------------------------------------ */

export type PrepareServiceBookingResult =
  | { ok: true; booking: ServiceBookingWriteSpec | null }
  | { ok: false; httpStatus: 403 | 400; code: string; message: string };

/**
 * The shared create-seam gate. Returns booking=null when the payload
 * carried no booking selection (the default path — byte-identical
 * behaviour for every non-service order). `items` are the order's
 * own lines: v1 allows ONE booking per order, for a line that is in
 * the order with a total quantity of exactly 1.
 */
export async function prepareServiceBooking(
  selection: ServiceBookingSelection | undefined,
  items: Array<{ variantId: string; quantity: number }>,
): Promise<PrepareServiceBookingResult> {
  if (selection === undefined) return { ok: true, booking: null };
  if (!isServicesEnabled()) {
    return {
      ok: false,
      httpStatus: 403,
      code: "FEATURE_LOCKED",
      message:
        "সেবা বুকিং মডিউল এই ইনস্টলে বন্ধ আছে। / The services booking module is locked for this install (module.services is OFF).",
    };
  }
  const { effective } = await loadServicesConfig();
  const validated = validateServiceBooking(selection, effective, dhakaNowParts());
  if (!validated.ok) {
    return { ok: false, httpStatus: 400, code: validated.code, message: validated.message };
  }
  const bookedQty = items
    .filter((i) => i.variantId === selection.variantId)
    .reduce((sum, i) => sum + i.quantity, 0);
  if (bookedQty === 0) {
    return {
      ok: false,
      httpStatus: 400,
      code: "BOOKING_VARIANT_NOT_IN_ORDER",
      message:
        "বুকিংয়ের সেবাটি এই অর্ডারে নেই। / The booked service is not part of this order.",
    };
  }
  if (bookedQty !== 1) {
    return {
      ok: false,
      httpStatus: 400,
      code: "BOOKING_QUANTITY_MUST_BE_ONE",
      message:
        "বুকিংয়ের জন্য সেবাটির পরিমাণ ঠিক ১ হতে হবে। / A booking needs the service quantity to be exactly 1.",
    };
  }
  return {
    ok: true,
    booking: {
      ...validated.spec,
      capacityPerSlot: effective.capacityPerSlot,
      bufferMinutes: effective.bufferMinutes,
    },
  };
}

/**
 * Cancellation seam — called from applyOrderTransition's CANCELLED
 * block (and saveOrder's bulk funnel) with the kitchen-ticket
 * discipline: NEVER throws, no-ops when there is no booking or the
 * booking already reached a final state (COMPLETED / NO_SHOW /
 * CANCELLED). A cancelled order must never hold a live slot.
 */
export async function cancelServiceBookingForOrder(orderId: string): Promise<void> {
  try {
    await prisma.serviceBooking.updateMany({
      where: { orderId, status: "BOOKED" },
      data: { status: "CANCELLED" },
    });
  } catch (err) {
    console.error(`[services] booking cancel failed for order ${orderId}:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Availability (public)                                               */
/* ------------------------------------------------------------------ */

export interface ServiceSlotAvailability {
  start: string;
  end: string;
  /** BOOKED rows starting exactly at this slot. */
  bookedCount: number;
  capacity: number;
  /** True when a neighbouring booking's turnaround buffer blocks
   *  this slot even though bookedCount is 0. */
  blockedByBuffer: boolean;
  /** True once the slot start has passed (today only). */
  past: boolean;
  available: boolean;
}

export interface ServiceAvailability {
  variantId: string;
  date: string;
  /** null when the day itself is bookable (individual slots may
   *  still be full/past). "NOT_A_SERVICE" = the variant is not on
   *  the merchant's bookable list. */
  reason: ServiceDateReason | "NOT_A_SERVICE" | null;
  slots: ServiceSlotAvailability[];
}

export async function getServiceAvailability(
  variantId: string,
  date: string,
): Promise<ServiceAvailability> {
  const { effective } = await loadServicesConfig();
  if (!effective.serviceVariantIds.includes(variantId)) {
    return { variantId, date, reason: "NOT_A_SERVICE", slots: [] };
  }
  const now = dhakaNowParts();
  const reason = serviceDateReason(date, effective, now.todayYmd);
  if (reason) return { variantId, date, reason, slots: [] };

  const booked = await prisma.serviceBooking.findMany({
    where: { variantId, serviceDate: serviceDateInstant(date), status: "BOOKED" },
    select: { slotStart: true, slotEnd: true },
  });
  const isToday = date === now.todayYmd;
  const slots = generateDaySlots(effective).map((slot) => {
    const bookedCount = booked.filter((b) => b.slotStart === slot.start).length;
    const conflicts = booked.filter((b) =>
      slotConflicts(b, { slotStart: slot.start, slotEnd: slot.end }, effective.bufferMinutes),
    ).length;
    const past = isToday && hhmmToMinutes(slot.start) <= now.minutes;
    return {
      start: slot.start,
      end: slot.end,
      bookedCount,
      capacity: effective.capacityPerSlot,
      blockedByBuffer: conflicts > bookedCount,
      past,
      available: !past && conflicts < effective.capacityPerSlot,
    };
  });
  return { variantId, date, reason: null, slots };
}

/* ------------------------------------------------------------------ */
/* Admin board                                                         */
/* ------------------------------------------------------------------ */

export interface BookingBoardRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  variantId: string;
  productName: string;
  slotStart: string;
  slotEnd: string;
  staffLabel: string | null;
  status: ServiceBookingStatus;
  /** First name only + masked phone — the board never carries a
   *  customer's full identity (the social-proof privacy rule). */
  customerFirstName: string;
  customerPhoneMasked: string;
  createdAt: string;
}

export interface BookingBoardGroup {
  slotStart: string;
  slotEnd: string;
  bookings: BookingBoardRow[];
}

export interface BookingsBoard {
  date: string;
  groups: BookingBoardGroup[];
  counts: Record<ServiceBookingStatus, number>;
}

export async function getBookingsBoard(date: string): Promise<BookingsBoard> {
  const rows = await prisma.serviceBooking.findMany({
    where: { serviceDate: serviceDateInstant(date) },
    orderBy: [{ slotStart: "asc" }, { createdAt: "asc" }],
    take: 500,
    include: {
      order: {
        select: {
          id: true,
          orderNo: true,
          status: true,
          customerName: true,
          customerPhone: true,
          items: { select: { variantId: true, productName: true } },
        },
      },
    },
  });
  const counts: Record<ServiceBookingStatus, number> = {
    BOOKED: 0,
    COMPLETED: 0,
    CANCELLED: 0,
    NO_SHOW: 0,
  };
  const groups = new Map<string, BookingBoardGroup>();
  for (const row of rows) {
    const status = row.status as ServiceBookingStatus;
    if (status in counts) counts[status] += 1;
    const key = `${row.slotStart}|${row.slotEnd}`;
    let group = groups.get(key);
    if (!group) {
      group = { slotStart: row.slotStart, slotEnd: row.slotEnd, bookings: [] };
      groups.set(key, group);
    }
    group.bookings.push({
      id: row.id,
      orderId: row.order.id,
      orderNo: row.order.orderNo,
      orderStatus: row.order.status,
      variantId: row.variantId,
      productName:
        row.order.items.find((i) => i.variantId === row.variantId)?.productName ?? "—",
      slotStart: row.slotStart,
      slotEnd: row.slotEnd,
      staffLabel: row.staffLabel,
      status,
      customerFirstName: row.order.customerName.trim().split(/\s+/)[0] ?? "",
      customerPhoneMasked: maskPhone(row.order.customerPhone),
      createdAt: row.createdAt.toISOString(),
    });
  }
  return { date, groups: [...groups.values()], counts };
}

export type AdvanceServiceBookingResult =
  | { ok: true; booking: { id: string; status: ServiceBookingStatus } }
  | { ok: false; httpStatus: 404 | 409; code: string; message: string };

/**
 * Advance a booking from the board: BOOKED -> COMPLETED or
 * BOOKED -> NO_SHOW. Anything else (re-advancing a final booking, a
 * board-side CANCELLED, an unknown target) is a 409 — a stale board
 * must never silently rewrite history. CANCELLED is set only by the
 * order itself (the applyOrderTransition seam above).
 */
export async function advanceServiceBooking(
  bookingId: string,
  to: string,
): Promise<AdvanceServiceBookingResult> {
  const row = await prisma.serviceBooking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true },
  });
  if (!row) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "Booking not found." };
  }
  const current = row.status as ServiceBookingStatus;
  const allowed = (SERVICE_BOOKING_NEXT_STATUS[current] ?? []) as ServiceBookingStatus[];
  if (!allowed.includes(to as ServiceBookingStatus)) {
    return {
      ok: false,
      httpStatus: 409,
      code: "INVALID_TRANSITION",
      message: `বুকিংটি ${current} থেকে ${to}-তে নেওয়া যাবে না${allowed.length ? ` — সম্ভাব্য ধাপ: ${allowed.join(", ")}` : ""}। / Booking cannot move from ${current} to ${to}${allowed.length ? ` — allowed: ${allowed.join(", ")}` : " (final state)"}.`,
    };
  }
  const updated = await prisma.serviceBooking.update({
    where: { id: bookingId },
    data: { status: to },
    select: { id: true, status: true },
  });
  return { ok: true, booking: { id: updated.id, status: updated.status as ServiceBookingStatus } };
}
