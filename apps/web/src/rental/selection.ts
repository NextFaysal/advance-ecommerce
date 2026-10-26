/**
 * Rental selection — ADV-23 vertical 3 (doc 23, wave 56).
 *
 * PURE module (zod + types + date/string math only, no prisma /
 * settings imports) so the checkout form schema can embed the
 * selection shape client-side, exactly like the restaurant and
 * services selections. The server-side config + persistence live
 * in src/rental/config.ts and src/rental/bookings.ts.
 *
 * Rentals differ from services by DATES + DEPOSIT, not slots: the
 * selection is a day RANGE on the Asia/Dhaka calendar,
 *   rental: { variantId, startDate: "yyyy-mm-dd", endDate: "yyyy-mm-dd" }
 * and the rental length is the INCLUSIVE day count (a same-day
 * rental is 1 day). The selection is validated AGAIN server-side
 * against the stored config at create time
 * (validateRentalSelection) — the client's view is never trusted,
 * mirroring the restaurant / services contract.
 *
 * Availability semantics (enforced inside the create transaction,
 * see src/rental/bookings.ts): a rental variant's physical unit
 * count is its ProductVariant.stock; a new rental may start only
 * while the ACTIVE rentals overlapping the requested window are
 * fewer than stock. Overlap is inclusive on both ends — a unit
 * returned on day X is out through day X (v1 has no same-day
 * turnaround), so [start, end] windows that merely touch still
 * conflict.
 *
 * The deposit is computed here (pure) from the config + the rental
 * line's unit price, and FROZEN onto the RentalBooking row at
 * create; the money itself enters the order through the checkout
 * pricing pipeline as the `rentalDepositPoisha` line
 * (src/checkout/pricing.ts) — see src/rental/bookings.ts for the
 * full money contract.
 */
import { z } from "zod";
import { isValidYmd, shiftYmd } from "@/lib/dhaka-date";

export const rentalSelectionSchema = z.object({
  variantId: z.string().min(1),
  /** First rental day (Asia/Dhaka calendar day, yyyy-mm-dd). */
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Start date must be yyyy-mm-dd"),
  /** Last rental day (inclusive, yyyy-mm-dd). */
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "End date must be yyyy-mm-dd"),
});

export type RentalSelection = z.infer<typeof rentalSelectionSchema>;

export const RENTAL_STATUSES = ["ACTIVE", "RETURNED", "OVERDUE", "CANCELLED"] as const;

export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS_BN: Record<RentalStatus, string> = {
  ACTIVE: "ভাড়ায় আছে",
  RETURNED: "ফেরত এসেছে",
  OVERDUE: "মেয়াদোত্তীর্ণ",
  CANCELLED: "বাতিল",
};

export const RENTAL_STATUS_LABELS_EN: Record<RentalStatus, string> = {
  ACTIVE: "Active",
  RETURNED: "Returned",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
};

/** Board-side transitions only. CANCELLED is NOT reachable from the
 *  board — it is set only by the order-cancellation seam. OVERDUE
 *  can be marked manually from the board and is also the computed
 *  display state of an ACTIVE row past its endDate. */
export const RENTAL_NEXT_STATUS: Partial<Record<RentalStatus, RentalStatus[]>> = {
  ACTIVE: ["RETURNED", "OVERDUE"],
  OVERDUE: ["RETURNED"],
};

/** Label of the deposit line wherever a pricing breakdown renders
 *  (checkout confirmation, invoice). The deposit is a REFUNDABLE
 *  security deposit, and the label says so. */
export const RENTAL_DEPOSIT_LABEL_BN = "ভাড়ার জামানত (ফেরতযোগ্য)";
export const RENTAL_DEPOSIT_LABEL_EN = "Rental deposit (refundable)";

/**
 * The merchant's rental config as the pure helpers need it
 * (src/rental/config.ts resolves the stored doc into this).
 * `rentalVariantIds` is the v1 "what is rentable" marker — the
 * services precedent: the Product type enum has no RENTAL value,
 * so rentable variants are an explicit merchant-maintained list.
 * Nothing is rentable until the merchant lists it.
 * `lateFeePerDayPoisha` is CONFIG ONLY in v1: stored and shown,
 * never charged automatically (no cron, no auto-charge flow).
 */
export interface EffectiveRentalConfig {
  rentalVariantIds: string[];
  maxRentalDays: number;
  depositMode: "none" | "fixed" | "percent";
  depositFixedPoisha: number;
  depositPercentBps: number;
  lateFeePerDayPoisha: number;
}

/** The validated rental spec both create seams hand to
 *  createOrderRecord (which writes the RentalBooking row inside
 *  the create transaction and enforces availability there). */
export interface RentalSpec {
  variantId: string;
  /** First rental day, yyyy-mm-dd (Dhaka). */
  startDate: string;
  /** Last rental day (inclusive), yyyy-mm-dd (Dhaka). */
  endDate: string;
  /** Inclusive day count, frozen at prepare time. */
  days: number;
  /** Security deposit charged with this order (poisha), frozen. */
  depositPoisha: number;
}

/** The write spec is the display spec in v1 — the transaction
 *  re-reads the variant's stock itself for the availability count,
 *  so no config value needs freezing for enforcement (the services
 *  write spec froze capacity/buffer because those live in config;
 *  the rental cap lives on the variant row). The alias is kept so
 *  the repository seam reads like the services one. */
export type RentalWriteSpec = RentalSpec;

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

/** The Dhaka-midnight instant a rental day is stored and queried
 *  as (yyyy-mm-ddT00:00:00+06:00) — one canonical instant per Dhaka
 *  day, so range comparisons are exact (the ServiceBooking
 *  convention). */
export function rentalDateInstant(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000+06:00`);
}

/** Inclusive day count of [startYmd, endYmd] (same day = 1).
 *  Calendar arithmetic in UTC is exact for ymd values. Negative
 *  when end < start — callers validate before relying on it. */
export function rentalDaysInclusive(startYmd: string, endYmd: string): number {
  const start = new Date(`${startYmd}T00:00:00.000Z`).getTime();
  const end = new Date(`${endYmd}T00:00:00.000Z`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

/** Whole Dhaka days from today until a ymd (0 = today, negative =
 *  past). Used by the board's "days remaining / overdue by" math. */
export function daysFromToday(ymd: string, todayYmd: string): number {
  return rentalDaysInclusive(todayYmd, ymd) - 1;
}

/* ------------------------------------------------------------------ */
/* Deposit                                                             */
/* ------------------------------------------------------------------ */

/**
 * The security deposit for one rental line, in poisha:
 *   none    -> 0
 *   fixed   -> depositFixedPoisha (flat per rental, quantity is 1)
 *   percent -> depositPercentBps of the line's unit price,
 *              rounded half-up with integer math only.
 * The line's unit price is the SERVER price on the public seam and
 * the staff-entered price on the manual seam — in both cases the
 * price the customer actually pays for the line, never a
 * client-supplied figure on the public path.
 */
export function computeRentalDepositPoisha(
  config: EffectiveRentalConfig,
  unitPricePoisha: number,
): number {
  if (config.depositMode === "fixed") return Math.max(0, config.depositFixedPoisha);
  if (config.depositMode === "percent") {
    return Math.max(0, Math.round((unitPricePoisha * config.depositPercentBps) / 10000));
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/* Selection validation (pure part)                                    */
/* ------------------------------------------------------------------ */

export type RentalValidation =
  | { ok: true; spec: RentalSpec }
  | { ok: false; code: string; message: string };

/**
 * Validate a submitted selection against the effective config, the
 * rental line's server-side unit price (for the deposit), and
 * "today" on the Dhaka calendar. Availability is NOT checked here
 * — overlapping ACTIVE rentals are counted inside the
 * order-create transaction (see src/rental/bookings.ts
 * prepareRentalBooking and the RentalBooking write in
 * src/orders/repository.ts). Rules:
 *   - the variant must be on the merchant's rentalVariantIds list;
 *   - both dates must be real days; start must not be past;
 *   - end must not precede start;
 *   - the inclusive length must not exceed maxRentalDays.
 */
export function validateRentalSelection(
  selection: RentalSelection,
  config: EffectiveRentalConfig,
  unitPricePoisha: number,
  todayYmd: string,
): RentalValidation {
  if (!config.rentalVariantIds.includes(selection.variantId)) {
    return {
      ok: false,
      code: "RENTAL_VARIANT_NOT_RENTABLE",
      message:
        "এই আইটেমটি ভাড়ার জন্য তালিকাভুক্ত নয়। / This item is not listed for rental.",
    };
  }
  if (!isValidYmd(selection.startDate) || !isValidYmd(selection.endDate)) {
    return {
      ok: false,
      code: "RENTAL_DATE_INVALID",
      message: "ভাড়ার তারিখ সঠিক নয়। / The rental dates are not valid.",
    };
  }
  if (selection.startDate < todayYmd) {
    return {
      ok: false,
      code: "RENTAL_START_PAST",
      message: "ভাড়া শুরুর তারিখ অতীতে হতে পারবে না। / The rental start date cannot be in the past.",
    };
  }
  if (selection.endDate < selection.startDate) {
    return {
      ok: false,
      code: "RENTAL_END_BEFORE_START",
      message: "ফেরতের তারিখ শুরুর তারিখের আগে হতে পারবে না। / The return date cannot be before the start date.",
    };
  }
  const days = rentalDaysInclusive(selection.startDate, selection.endDate);
  if (days > config.maxRentalDays) {
    return {
      ok: false,
      code: "RENTAL_TOO_LONG",
      message: `একবারে সর্বোচ্চ ${config.maxRentalDays} দিনের জন্য ভাড়া নেওয়া যায়। / A single rental can run at most ${config.maxRentalDays} days.`,
    };
  }
  return {
    ok: true,
    spec: {
      variantId: selection.variantId,
      startDate: selection.startDate,
      endDate: selection.endDate,
      days,
      depositPoisha: computeRentalDepositPoisha(config, unitPricePoisha),
    },
  };
}

/** The last start date the checkout date inputs allow (today +
 *  maxRentalDays — a display bound only; the server enforces the
 *  length rule itself). */
export function rentalMaxStartYmd(config: EffectiveRentalConfig, todayYmd: string): string {
  return shiftYmd(todayYmd, config.maxRentalDays);
}
