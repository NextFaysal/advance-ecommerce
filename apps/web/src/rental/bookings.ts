/**
 * Rental bookings — ADV-23 vertical 3 (doc 23, wave 56).
 *
 * The order-create seam + the availability read + the admin board
 * service over the RentalBooking table (one row per rental order,
 * written INSIDE the order-create transaction by
 * src/orders/repository.ts — callers here only VALIDATE and hand
 * the spec over; see prepareRentalBooking).
 *
 * Create-path contract (both seams — the public orders route and
 * createManualOrder — run the identical steps):
 *   payload has no `rental` field -> null; nothing changes.
 *   field present + flag OFF       -> 403 FEATURE_LOCKED (a locked
 *                                     module never runs open).
 *   field present + flag ON        -> validate against the stored
 *                                     rental.config + the order's
 *                                     own items; a violation is a
 *                                     400 with the bilingual message.
 *   availability                   -> counted INSIDE the create
 *                                     transaction by the repository
 *                                     (live rentals — stored ACTIVE
 *                                     or OVERDUE — overlapping the
 *                                     requested window vs the
 *                                     variant's stock); a fully
 *                                     booked window aborts the
 *                                     create with
 *                                     RentalCapacityError (defined
 *                                     in src/orders/repository.ts)
 *                                     -> 409. Residual race, stated
 *                                     honestly (same as services):
 *                                     under Prisma's default
 *                                     ReadCommitted isolation two
 *                                     simultaneous creates can both
 *                                     pass the count in theory
 *                                     (write skew — Postgres has no
 *                                     unique partial index for
 *                                     "overlapping rentals per
 *                                     variant" to lean on).
 *                                     Single-tenant rental volume +
 *                                     the sub-second window keep it
 *                                     small; it is NOT zero.
 *
 * STOCK MODEL — read before touching: the rental line is EXCLUDED
 * from the generic SALE_RESERVE stock claim in the create
 * transaction. ProductVariant.stock for a rental variant is its
 * physical fleet size and stays put while units are out; the
 * overlap count above is the rental line's only stock control.
 * Claiming through the sale ledger too would double-count the unit
 * (once as a decrement, once as an overlap) and never return it —
 * SALE_RESERVE is terminal at delivery, so a returned unit would
 * stay "sold" forever.
 *
 * DEPOSIT MONEY — the one money touch in this vertical: when
 * rental.config depositMode != "none", prepareRentalBooking
 * computes the deposit from the config + the rental line's price
 * (server price on the public seam, staff-entered price on the
 * manual seam) and the callers pass it into the checkout pricing
 * pipeline as `rentalDepositPoisha` (src/checkout/pricing.ts),
 * where it becomes its own breakdown line, is added to the grand
 * total AFTER the gift-card stage (a gift card can never cover a
 * refundable deposit), and lands in Order.totalPoisha. The same
 * figure is frozen on RentalBooking.depositPoisha. The deposit
 * REFUND on return is a MANUAL admin action in v1 — the rentals
 * board shows the frozen amount and says so; no auto-refund flow
 * exists. Late fees are config-only in v1: lateFeePerDayPoisha is
 * displayed on the board as the contractual rate and is never
 * charged automatically.
 */
import { prisma } from "@advance-ecommerce/db";
import { maskPhone } from "@advance-ecommerce/validators";
import { dhakaYmdOf, todayDhakaYmd } from "@/lib/dhaka-date";
import { loadRentalConfig } from "./config";
import { isRentalEnabled } from "./flags";
import {
  RENTAL_NEXT_STATUS,
  rentalDateInstant,
  rentalDaysInclusive,
  validateRentalSelection,
  type RentalSelection,
  type RentalStatus,
  type RentalWriteSpec,
} from "./selection";

/* ------------------------------------------------------------------ */
/* Create seam                                                         */
/* ------------------------------------------------------------------ */

export type PrepareRentalResult =
  | { ok: true; rental: RentalWriteSpec | null }
  | { ok: false; httpStatus: 403 | 400; code: string; message: string };

/**
 * The shared create-seam gate. Returns rental=null when the
 * payload carried no rental selection (the default path —
 * byte-identical behaviour for every non-rental order). `items`
 * are the order's own lines WITH the prices the order will
 * actually charge (server snapshots on the public seam,
 * staff-entered prices on the manual seam): v1 allows ONE rental
 * per order, for a line whose total quantity is exactly 1, and a
 * percent deposit is derived from that line's price.
 */
export async function prepareRentalBooking(
  selection: RentalSelection | undefined,
  items: Array<{ variantId: string; quantity: number; unitPricePoisha: number }>,
): Promise<PrepareRentalResult> {
  if (selection === undefined) return { ok: true, rental: null };
  if (!isRentalEnabled()) {
    return {
      ok: false,
      httpStatus: 403,
      code: "FEATURE_LOCKED",
      message:
        "ভাড়া মডিউল এই ইনস্টলে বন্ধ আছে। / The rental module is locked for this install (module.rental is OFF).",
    };
  }
  const rentalQty = items
    .filter((i) => i.variantId === selection.variantId)
    .reduce((sum, i) => sum + i.quantity, 0);
  if (rentalQty === 0) {
    return {
      ok: false,
      httpStatus: 400,
      code: "RENTAL_VARIANT_NOT_IN_ORDER",
      message:
        "ভাড়ার আইটেমটি এই অর্ডারে নেই। / The rented item is not part of this order.",
    };
  }
  if (rentalQty !== 1) {
    return {
      ok: false,
      httpStatus: 400,
      code: "RENTAL_QUANTITY_MUST_BE_ONE",
      message:
        "ভাড়ার জন্য আইটেমটির পরিমাণ ঠিক ১ হতে হবে। / A rental needs the item quantity to be exactly 1.",
    };
  }
  const line = items.find((i) => i.variantId === selection.variantId);
  const { effective } = await loadRentalConfig();
  const validated = validateRentalSelection(
    selection,
    effective,
    line?.unitPricePoisha ?? 0,
    todayDhakaYmd(),
  );
  if (!validated.ok) {
    return { ok: false, httpStatus: 400, code: validated.code, message: validated.message };
  }
  return { ok: true, rental: validated.spec };
}

/** The create-time order-note line both create seams record for a
 *  rental order (the pickup-choice note precedent): the frozen
 *  window + day count, and the deposit truth — charged inside the
 *  total and refunded MANUALLY on return, or explicitly none. */
export function rentalOrderNoteText(spec: RentalWriteSpec): string {
  const deposit =
    spec.depositPoisha > 0
      ? `জামানত ${spec.depositPoisha} পয়সা অর্ডারের মোট মূল্যে অন্তর্ভুক্ত (ফেরতযোগ্য — ফেরতের সময় ম্যানুয়ালি ফেরত দিতে হবে)। / A deposit of ${spec.depositPoisha} poisha is included in the order total (refundable — refund it manually on return).`
      : "কোনো জামানত নেওয়া হয়নি। / No deposit was charged.";
  return `ভাড়া: ${spec.startDate} থেকে ${spec.endDate} পর্যন্ত (${spec.days} দিন)। ${deposit} / Rental: ${spec.startDate} to ${spec.endDate} (${spec.days} day${spec.days === 1 ? "" : "s"}).`;
}

/**
 * Cancellation seam — called from applyOrderTransition's CANCELLED
 * block (and saveOrder's bulk funnel) with the kitchen-ticket /
 * service-booking discipline: NEVER throws, no-ops when there is
 * no rental or the rental already reached a final state (RETURNED
 * / CANCELLED). An ACTIVE or OVERDUE rental on a cancelled order
 * is cancelled with it, freeing the unit for the window. The
 * deposit on such an order is settled manually (v1) — cancelling
 * here never moves money.
 */
export async function cancelRentalBookingForOrder(orderId: string): Promise<void> {
  try {
    await prisma.rentalBooking.updateMany({
      where: { orderId, status: { in: ["ACTIVE", "OVERDUE"] } },
      data: { status: "CANCELLED" },
    });
  } catch (err) {
    console.error(`[rental] booking cancel failed for order ${orderId}:`, err);
  }
}

/* ------------------------------------------------------------------ */
/* Availability (public)                                               */
/* ------------------------------------------------------------------ */

export interface RentalAvailability {
  variantId: string;
  startDate: string;
  endDate: string;
  /** Physical units of the variant (ProductVariant.stock); null
   *  when the variant is not on the rental list (nothing else is
   *  disclosed about it). */
  totalUnits: number | null;
  /** ACTIVE rentals overlapping the requested window. */
  overlappingActive: number;
  /** Units that can still go out for the whole window. */
  availableUnits: number;
  /** null when the window itself is bookable (units may still be
   *  0). "NOT_A_RENTAL" = the variant is not on the merchant's
   *  rental list. */
  reason: "NOT_A_RENTAL" | "INVALID_RANGE" | "START_PAST" | "TOO_LONG" | null;
}

export async function getRentalAvailability(
  variantId: string,
  startDate: string,
  endDate: string,
): Promise<RentalAvailability> {
  const base = { variantId, startDate, endDate };
  const { effective } = await loadRentalConfig();
  if (!effective.rentalVariantIds.includes(variantId)) {
    return { ...base, totalUnits: null, overlappingActive: 0, availableUnits: 0, reason: "NOT_A_RENTAL" };
  }
  const validated = validateRentalSelection(
    { variantId, startDate, endDate },
    effective,
    0,
    todayDhakaYmd(),
  );
  if (!validated.ok) {
    const reason =
      validated.code === "RENTAL_START_PAST"
        ? "START_PAST"
        : validated.code === "RENTAL_TOO_LONG"
          ? "TOO_LONG"
          : "INVALID_RANGE";
    return { ...base, totalUnits: null, overlappingActive: 0, availableUnits: 0, reason };
  }
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { stock: true, deletedAt: true },
  });
  const totalUnits = variant && !variant.deletedAt ? variant.stock : 0;
  // Live rentals = stored ACTIVE + OVERDUE: an overdue unit is
  // still physically out, so it keeps holding its unit until it is
  // RETURNED (or its order is cancelled). Counting only the stored
  // ACTIVE string would free a unit that has not come back.
  const overlappingActive = await prisma.rentalBooking.count({
    where: {
      variantId,
      status: { in: ["ACTIVE", "OVERDUE"] },
      startDate: { lte: rentalDateInstant(endDate) },
      endDate: { gte: rentalDateInstant(startDate) },
    },
  });
  return {
    ...base,
    totalUnits,
    overlappingActive,
    availableUnits: Math.max(0, totalUnits - overlappingActive),
    reason: null,
  };
}

/* ------------------------------------------------------------------ */
/* Admin board                                                         */
/* ------------------------------------------------------------------ */

export interface RentalBoardRow {
  id: string;
  orderId: string;
  orderNo: string;
  orderStatus: string;
  variantId: string;
  productName: string;
  startDate: string;
  endDate: string;
  days: number;
  /** Deposit frozen at order time (poisha) — refunded MANUALLY on
   *  return in v1; the board never moves money. */
  depositPoisha: number;
  /** Stored status. */
  status: RentalStatus;
  /** What staff should read: an ACTIVE rental past its endDate
   *  displays OVERDUE even before anyone marks it (computed at
   *  read — there is no cron flipping rows). */
  displayStatus: RentalStatus;
  /** Days until the return date (endDate − today); negative =
   *  overdue by that many days. */
  daysRemaining: number;
  returnedAt: string | null;
  /** First name only + masked phone — the board never carries a
   *  customer's full identity (the social-proof privacy rule). */
  customerFirstName: string;
  customerPhoneMasked: string;
  createdAt: string;
}

export interface RentalsBoard {
  today: string;
  rentals: RentalBoardRow[];
  counts: Record<RentalStatus, number>;
  /** Contractual late fee per day from rental.config — DISPLAY
   *  ONLY in v1; nothing charges it automatically. */
  lateFeePerDayPoisha: number;
}

export async function getRentalsBoard(): Promise<RentalsBoard> {
  const today = todayDhakaYmd();
  const [rows, grouped, { effective }] = await Promise.all([
    prisma.rentalBooking.findMany({
      where: { status: { in: ["ACTIVE", "OVERDUE"] } },
      orderBy: [{ endDate: "asc" }, { createdAt: "asc" }],
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
    }),
    prisma.rentalBooking.groupBy({ by: ["status"], _count: { _all: true } }),
    loadRentalConfig(),
  ]);
  const counts: Record<RentalStatus, number> = {
    ACTIVE: 0,
    RETURNED: 0,
    OVERDUE: 0,
    CANCELLED: 0,
  };
  for (const g of grouped) {
    const status = g.status as RentalStatus;
    if (status in counts) counts[status] = g._count._all;
  }
  const rentals: RentalBoardRow[] = rows.map((row) => {
    const status = row.status as RentalStatus;
    const endYmd = dhakaYmdOf(row.endDate);
    const daysRemaining = rentalDaysInclusive(today, endYmd) - 1;
    return {
      id: row.id,
      orderId: row.order.id,
      orderNo: row.order.orderNo,
      orderStatus: row.order.status,
      variantId: row.variantId,
      productName:
        row.order.items.find((i) => i.variantId === row.variantId)?.productName ?? "—",
      startDate: dhakaYmdOf(row.startDate),
      endDate: endYmd,
      days: row.days,
      depositPoisha: row.depositPoisha,
      status,
      displayStatus: status === "ACTIVE" && daysRemaining < 0 ? "OVERDUE" : status,
      daysRemaining,
      returnedAt: row.returnedAt ? row.returnedAt.toISOString() : null,
      customerFirstName: row.order.customerName.trim().split(/\s+/)[0] ?? "",
      customerPhoneMasked: maskPhone(row.order.customerPhone),
      createdAt: row.createdAt.toISOString(),
    };
  });
  return { today, rentals, counts, lateFeePerDayPoisha: effective.lateFeePerDayPoisha };
}

export type AdvanceRentalResult =
  | { ok: true; rental: { id: string; status: RentalStatus; returnedAt: string | null } }
  | { ok: false; httpStatus: 404 | 409; code: string; message: string };

/**
 * Advance a rental from the board: ACTIVE -> RETURNED (stamps
 * returnedAt), ACTIVE -> OVERDUE (manual mark; the board already
 * displays a past-due ACTIVE row as overdue), OVERDUE -> RETURNED.
 * Anything else (re-advancing a final rental, a board-side
 * CANCELLED) is a 409 — a stale board must never silently rewrite
 * history. CANCELLED is set only by the order itself (the
 * applyOrderTransition seam above). Marking RETURNED moves NO
 * money: the frozen deposit is refunded manually in v1.
 */
export async function advanceRentalBooking(
  rentalId: string,
  to: string,
): Promise<AdvanceRentalResult> {
  const row = await prisma.rentalBooking.findUnique({
    where: { id: rentalId },
    select: { id: true, status: true, returnedAt: true },
  });
  if (!row) {
    return { ok: false, httpStatus: 404, code: "NOT_FOUND", message: "Rental not found." };
  }
  const current = row.status as RentalStatus;
  const allowed = (RENTAL_NEXT_STATUS[current] ?? []) as RentalStatus[];
  if (!allowed.includes(to as RentalStatus)) {
    return {
      ok: false,
      httpStatus: 409,
      code: "INVALID_TRANSITION",
      message: `ভাড়াটি ${current} থেকে ${to}-তে নেওয়া যাবে না${allowed.length ? ` — সম্ভাব্য ধাপ: ${allowed.join(", ")}` : ""}। / Rental cannot move from ${current} to ${to}${allowed.length ? ` — allowed: ${allowed.join(", ")}` : " (final state)"}.`,
    };
  }
  const updated = await prisma.rentalBooking.update({
    where: { id: rentalId },
    data: {
      status: to,
      ...(to === "RETURNED" ? { returnedAt: new Date() } : {}),
    },
    select: { id: true, status: true, returnedAt: true },
  });
  return {
    ok: true,
    rental: {
      id: updated.id,
      status: updated.status as RentalStatus,
      returnedAt: updated.returnedAt ? updated.returnedAt.toISOString() : null,
    },
  };
}
