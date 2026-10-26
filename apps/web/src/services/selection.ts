/**
 * Service booking selection — ADV-23 vertical 2 (doc 23, wave 56).
 *
 * PURE module (zod + types + date/string math only, no prisma /
 * settings imports) so the checkout form schema can embed the
 * selection shape client-side, exactly like the restaurant
 * selection in src/checkout/validation.ts. The server-side config +
 * persistence live in src/services/config.ts and
 * src/services/bookings.ts.
 *
 * The selection is what a create payload carries:
 *   booking: { variantId, date: "yyyy-mm-dd", slotStart: "HH:MM",
 *              staffLabel? }
 * `date` is an Asia/Dhaka calendar day; slotStart is a start time on
 * the merchant's services.config slot grid. The selection is
 * validated AGAIN server-side against the stored config at create
 * time (validateServiceBooking) — the client's view of the grid is
 * never trusted, mirroring the delivery-slot / restaurant contract.
 *
 * WHY CLOCK SLOTS AND NOT src/checkout/delivery-slots.ts: delivery
 * slots are NAMED day bands ("morning / afternoon / evening") for
 * courier delivery — a service appointment needs an exact start
 * time, so the grid here is generated from the config's
 * openTime/closeTime/slotMinutes. What IS reused from the platform's
 * time machinery: the Dhaka calendar helpers in src/lib/dhaka-date.ts
 * (today/shift/weekday reasoning) and the Setting-doc + fail-soft
 * config discipline the delivery slots established.
 */
import { z } from "zod";
import { isValidYmd, shiftYmd } from "@/lib/dhaka-date";

export const serviceBookingSelectionSchema = z.object({
  variantId: z.string().min(1),
  /** Asia/Dhaka calendar day, yyyy-mm-dd. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be yyyy-mm-dd"),
  /** Slot start on the config grid, "HH:MM" (24h). */
  slotStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Slot start must be HH:MM"),
  /** Optional resource/person label (v1: free text, no calendar). */
  staffLabel: z.string().trim().min(1).max(60).optional(),
});

export type ServiceBookingSelection = z.infer<typeof serviceBookingSelectionSchema>;

export const SERVICE_BOOKING_STATUSES = ["BOOKED", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;

export type ServiceBookingStatus = (typeof SERVICE_BOOKING_STATUSES)[number];

export const SERVICE_BOOKING_STATUS_LABELS_BN: Record<ServiceBookingStatus, string> = {
  BOOKED: "বুক করা",
  COMPLETED: "সম্পন্ন",
  CANCELLED: "বাতিল",
  NO_SHOW: "আসেননি",
};

export const SERVICE_BOOKING_STATUS_LABELS_EN: Record<ServiceBookingStatus, string> = {
  BOOKED: "Booked",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};

/** Board-side transitions only. CANCELLED is NOT reachable from the
 *  board — it is set only by the order-cancellation seam. */
export const SERVICE_BOOKING_NEXT_STATUS: Partial<
  Record<ServiceBookingStatus, ServiceBookingStatus[]>
> = {
  BOOKED: ["COMPLETED", "NO_SHOW"],
};

/**
 * The merchant's services config as the pure helpers need it
 * (src/services/config.ts resolves the stored doc into this).
 * `serviceVariantIds` is the v1 "what is a service" marker: the
 * Product type enum is SIMPLE | DIGITAL | BUNDLE | PREORDER — there
 * is no SERVICE type and adding one would ripple through the whole
 * product-types machinery, so bookable variants are an explicit
 * merchant-maintained list in the config doc. Explicit and honest:
 * nothing is a service unless the merchant lists it.
 */
export interface EffectiveServicesConfig {
  slotMinutes: 15 | 30 | 60;
  openTime: string;
  closeTime: string;
  closedWeekdays: number[];
  advanceDays: number;
  bufferMinutes: number;
  capacityPerSlot: number;
  serviceVariantIds: string[];
}

/** The validated booking spec both create seams hand to
 *  createOrderRecord (which writes the ServiceBooking row inside the
 *  create transaction and enforces capacity there). */
export interface ServiceBookingSpec {
  variantId: string;
  /** Asia/Dhaka day, yyyy-mm-dd. */
  date: string;
  slotStart: string;
  slotEnd: string;
  staffLabel: string | null;
}

/** The spec as written: the display spec plus the two config values
 *  the in-transaction capacity count needs (how many BOOKED rows may
 *  conflict, and the turnaround window they conflict over). Frozen
 *  at prepare time so the transaction enforces the same rules the
 *  customer was validated against. */
export interface ServiceBookingWriteSpec extends ServiceBookingSpec {
  capacityPerSlot: number;
  bufferMinutes: number;
}

/* ------------------------------------------------------------------ */
/* HH:MM helpers                                                       */
/* ------------------------------------------------------------------ */

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((p) => Number(p));
  return (h || 0) * 60 + (m || 0);
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface ServiceSlot {
  start: string;
  end: string;
}

/** The day's slot grid: starts at openTime, steps slotMinutes, and a
 *  slot is offered only when it ENDS by closeTime. Buffer does NOT
 *  stretch the grid — it blocks neighbouring bookings (see
 *  slotConflicts), so the published start times stay round. */
export function generateDaySlots(config: EffectiveServicesConfig): ServiceSlot[] {
  const open = hhmmToMinutes(config.openTime);
  const close = hhmmToMinutes(config.closeTime);
  const slots: ServiceSlot[] = [];
  for (let start = open; start + config.slotMinutes <= close; start += config.slotMinutes) {
    slots.push({ start: minutesToHhmm(start), end: minutesToHhmm(start + config.slotMinutes) });
  }
  return slots;
}

/** Weekday (0 = Sunday … 6 = Saturday) of a yyyy-mm-dd calendar day.
 *  A ymd has no timezone of its own, so the UTC weekday of its
 *  midnight IS the calendar weekday. */
export function ymdWeekday(ymd: string): number {
  return new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
}

/** The Dhaka-midnight instant a ServiceBooking.serviceDate is
 *  stored and queried as (yyyy-mm-ddT00:00:00+06:00) — one canonical
 *  instant per Dhaka day, so equality queries are exact. */
export function serviceDateInstant(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+06:00`);
}

/** Why a date has no bookable slots at all (the availability API
 *  surfaces this instead of a bare empty list). */
export type ServiceDateReason =
  | "INVALID_DATE"
  | "PAST_DATE"
  | "CLOSED_WEEKDAY"
  | "BEYOND_ADVANCE_WINDOW";

export function serviceDateReason(
  date: string,
  config: EffectiveServicesConfig,
  todayYmd: string,
): ServiceDateReason | null {
  if (!isValidYmd(date)) return "INVALID_DATE";
  if (date < todayYmd) return "PAST_DATE";
  if (date > shiftYmd(todayYmd, config.advanceDays)) return "BEYOND_ADVANCE_WINDOW";
  if (config.closedWeekdays.includes(ymdWeekday(date))) return "CLOSED_WEEKDAY";
  return null;
}

/**
 * Does an existing BOOKED booking block a candidate slot? A booking
 * occupies [start, end + buffer) — the buffer is turnaround time
 * AFTER the appointment — and the candidate needs its own turnaround
 * too, so the test is symmetric: the two occupied windows must not
 * overlap. Touching edges (one ends exactly when the other starts,
 * buffer 0) do not conflict.
 */
export function slotConflicts(
  existing: { slotStart: string; slotEnd: string },
  candidate: { slotStart: string; slotEnd: string },
  bufferMinutes: number,
): boolean {
  const eStart = hhmmToMinutes(existing.slotStart);
  const eEnd = hhmmToMinutes(existing.slotEnd) + bufferMinutes;
  const cStart = hhmmToMinutes(candidate.slotStart);
  const cEnd = hhmmToMinutes(candidate.slotEnd) + bufferMinutes;
  return eStart < cEnd && cStart < eEnd;
}

/* ------------------------------------------------------------------ */
/* Selection validation (pure part)                                    */
/* ------------------------------------------------------------------ */

export type ServiceBookingValidation =
  | { ok: true; spec: ServiceBookingSpec }
  | { ok: false; code: string; message: string };

/**
 * Validate a submitted selection against the effective config and
 * the caller's "now" on the Dhaka calendar. Capacity is NOT checked
 * here — it is counted inside the order-create transaction (see
 * src/services/bookings.ts prepareServiceBooking and the
 * ServiceBooking write in src/orders/repository.ts). Rules:
 *   - the variant must be on the merchant's serviceVariantIds list;
 *   - the date must be a real day, not past, within advanceDays,
 *     and not a closed weekday;
 *   - slotStart must sit exactly on the grid and, for today, must
 *     still be in the future.
 */
export function validateServiceBooking(
  selection: ServiceBookingSelection,
  config: EffectiveServicesConfig,
  nowDhaka: { todayYmd: string; minutes: number },
): ServiceBookingValidation {
  if (!config.serviceVariantIds.includes(selection.variantId)) {
    return {
      ok: false,
      code: "BOOKING_VARIANT_NOT_SERVICE",
      message:
        "এই আইটেমটি বুকিংযোগ্য সেবা নয়। / This item is not a bookable service.",
    };
  }
  const reason = serviceDateReason(selection.date, config, nowDhaka.todayYmd);
  if (reason === "INVALID_DATE") {
    return {
      ok: false,
      code: "BOOKING_DATE_INVALID",
      message: "বুকিংয়ের তারিখটি সঠিক নয়। / The booking date is not valid.",
    };
  }
  if (reason === "PAST_DATE") {
    return {
      ok: false,
      code: "BOOKING_DATE_PAST",
      message: "অতীতের তারিখে বুকিং করা যাবে না। / Bookings cannot be made for a past date.",
    };
  }
  if (reason === "BEYOND_ADVANCE_WINDOW") {
    return {
      ok: false,
      code: "BOOKING_DATE_TOO_FAR",
      message: `সর্বোচ্চ ${config.advanceDays} দিন আগে পর্যন্ত বুকিং করা যায়। / Bookings open up to ${config.advanceDays} days ahead.`,
    };
  }
  if (reason === "CLOSED_WEEKDAY") {
    return {
      ok: false,
      code: "BOOKING_DAY_CLOSED",
      message: "এই দিনে সেবা বন্ধ থাকে। / The service is closed on this day of the week.",
    };
  }
  const slot = generateDaySlots(config).find((s) => s.start === selection.slotStart);
  if (!slot) {
    return {
      ok: false,
      code: "BOOKING_SLOT_OFF_GRID",
      message:
        "বেছে নেওয়া সময়টি সেবার সময়সূচিতে নেই — অনুগ্রহ করে আবার বেছে নিন। / The selected time is not on the service schedule — please choose again.",
    };
  }
  if (selection.date === nowDhaka.todayYmd && hhmmToMinutes(slot.start) <= nowDhaka.minutes) {
    return {
      ok: false,
      code: "BOOKING_SLOT_PAST",
      message: "এই সময়টি আজ ইতিমধ্যে পার হয়ে গেছে। / This time has already passed today.",
    };
  }
  return {
    ok: true,
    spec: {
      variantId: selection.variantId,
      date: selection.date,
      slotStart: slot.start,
      slotEnd: slot.end,
      staffLabel: selection.staffLabel?.trim() ? selection.staffLabel.trim() : null,
    },
  };
}
