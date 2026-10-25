/**
 * Auto-derived drawer-cash expectation for the daily cash closing
 * (doc 17, batch O8-2).
 *
 * Until now the closing's expected cash was arithmetic over numbers
 * staff typed by hand (cash sales, cash refunds, expenses, deposits),
 * so the "check" compared a count against the staff's own guess. This
 * module derives the day's expectation from the records instead:
 *
 *   expected = opening + cash IN − cash refunds SENT
 *
 * The PHYSICAL-CASH set — money that is literally in the shop drawer:
 *   IN  1. POS cash sales — PosSale rows with paymentMethod 'CASH'.
 *          PosSale.totalPoisha is the net payable (subtotal −
 *          discount, see src/pos/register.ts saleTotal), i.e. exactly
 *          what went into the drawer; tendered/change never counts.
 *   IN  2. Rider hand-ins — RiderDelivery.codHandedOverPoisha > 0.
 *          The riders service records what a rider actually handed
 *          over; there is no handedOverAt column, so the hand-in is
 *          attributed to the delivery's Dhaka day (deliveredAt) —
 *          riders hand in on delivery day in this operation.
 *   OUT    Cash refunds SENT that day — Refund rows with
 *          payoutMethod 'cash' whose transition INTO SENT (the
 *          audited orders.refund event in AuditLog) falls on the day.
 *          The audit row is the exact SENT moment; Refund.updatedAt
 *          is not used because a later CONFIRMED would move the day.
 *
 * Deliberately EXCLUDED (with reasons, also surfaced in the UI):
 *   - Courier-collected COD (Payment rows, method COD): the money is
 *     with the courier, not in the drawer — it belongs to the COD
 *     remittance ledger (batch O8-1), never to drawer cash.
 *   - bKash / Nagad / gateway receipts: electronic, separate channels
 *     of the closing, unchanged.
 *   - Counter / manual order collections: no row records a physical
 *     cash collection at the counter (manual-Trx approvals are mobile
 *     banking; gateway payments are electronic; exchange credits are
 *     book entries), so there is nothing honest to add.
 *   - Expenses / bank deposits: no expense or deposit records exist
 *     in the system, so the derived formula carries neither; staff
 *     explain any such movement in the closing note.
 *
 * Opening cash is derived too: the previous closing's COUNTED cash
 * (actualCashPoisha of the latest closing before this date), or 0
 * when no earlier closing exists. Staff may override it at submit
 * time — an opening count is a physical fact, not an expectation.
 *
 * Persistence note: DailyCashClosing has no JSON column, so the
 * breakdown below is computed live for display and returned with the
 * closing; only the derived expected figure itself is stored (in
 * expectedCashPoisha). Persisting the breakdown needs a schema field
 * (e.g. breakdownJson) — that migration belongs to a schema-owning
 * batch, not this derive-only wave.
 */
import { prisma } from "@advance-ecommerce/db";
import {
  buildDailyCashClosing,
  type CashChannelInput,
  type DailyCashClosing,
} from "./cash-closing";
import { dhakaDayRangeUtc, isValidYmd } from "@/lib/dhaka-date";

export interface DrawerCashLine {
  key: "pos_cash_sales" | "rider_hand_ins" | "cash_refunds_sent";
  labelBn: string;
  labelEn: string;
  direction: "in" | "out";
  amountPoisha: number;
  /** How many records the line was derived from. */
  recordCount: number;
}

export interface DerivedDrawerCash {
  date: string;
  openingCashPoisha: number;
  openingSource: "previous_closing" | "none_recorded";
  lines: DrawerCashLine[];
  cashInPoisha: number;
  cashRefundsSentPoisha: number;
  /** opening + in − refunds sent — the drawer expectation. */
  expectedCashPoisha: number;
  /** Plain-language exclusions, shown in the UI so nobody wonders
   *  where courier COD went. */
  exclusionsBn: string[];
}

export async function deriveDrawerCash(ymd: string): Promise<DerivedDrawerCash> {
  if (!isValidYmd(ymd)) throw new Error(`Invalid closing date: ${ymd}`);
  const { startUtc, endUtc } = dhakaDayRangeUtc(ymd);
  const closingDayStart = new Date(`${ymd}T00:00:00.000Z`);

  const [previousClosing, posAgg, posCount, riderAgg, riderCount, sentAudits] =
    await Promise.all([
      prisma.dailyCashClosing.findFirst({
        where: { closingDate: { lt: closingDayStart } },
        orderBy: { closingDate: "desc" },
        select: { actualCashPoisha: true },
      }),
      prisma.posSale.aggregate({
        where: { paymentMethod: "CASH", createdAt: { gte: startUtc, lte: endUtc } },
        _sum: { totalPoisha: true },
      }),
      prisma.posSale.count({
        where: { paymentMethod: "CASH", createdAt: { gte: startUtc, lte: endUtc } },
      }),
      prisma.riderDelivery.aggregate({
        where: {
          codHandedOverPoisha: { gt: 0 },
          deliveredAt: { gte: startUtc, lte: endUtc },
        },
        _sum: { codHandedOverPoisha: true },
      }),
      prisma.riderDelivery.count({
        where: {
          codHandedOverPoisha: { gt: 0 },
          deliveredAt: { gte: startUtc, lte: endUtc },
        },
      }),
      prisma.auditLog.findMany({
        where: {
          action: "orders.refund",
          entityType: "Refund",
          createdAt: { gte: startUtc, lte: endUtc },
        },
        select: { entityId: true, afterJson: true },
      }),
    ]);

  // Refunds that entered SENT on this Dhaka day, per the audit trail;
  // of those, only payoutMethod 'cash' left the drawer.
  const sentRefundIds = sentAudits
    .filter((row) => {
      const after = row.afterJson as { status?: unknown } | null;
      return after?.status === "SENT" && typeof row.entityId === "string";
    })
    .map((row) => row.entityId as string);
  let cashRefundsSentPoisha = 0;
  let cashRefundCount = 0;
  if (sentRefundIds.length > 0) {
    const cashRefunds = await prisma.refund.findMany({
      where: { id: { in: sentRefundIds }, payoutMethod: "cash" },
      select: { amountPoisha: true },
    });
    cashRefundCount = cashRefunds.length;
    cashRefundsSentPoisha = cashRefunds.reduce((s, r) => s + r.amountPoisha, 0);
  }

  const posCashPoisha = posAgg._sum.totalPoisha ?? 0;
  const riderHandedPoisha = riderAgg._sum.codHandedOverPoisha ?? 0;
  const openingCashPoisha = previousClosing?.actualCashPoisha ?? 0;
  const cashInPoisha = posCashPoisha + riderHandedPoisha;

  return {
    date: ymd,
    openingCashPoisha,
    openingSource: previousClosing ? "previous_closing" : "none_recorded",
    lines: [
      {
        key: "pos_cash_sales",
        labelBn: "POS নগদ বিক্রয়",
        labelEn: "POS cash sales",
        direction: "in",
        amountPoisha: posCashPoisha,
        recordCount: posCount,
      },
      {
        key: "rider_hand_ins",
        labelBn: "রাইডারের হস্তান্তর (COD)",
        labelEn: "Rider COD hand-ins",
        direction: "in",
        amountPoisha: riderHandedPoisha,
        recordCount: riderCount,
      },
      {
        key: "cash_refunds_sent",
        labelBn: "নগদ ফেরত (পাঠানো হয়েছে)",
        labelEn: "Cash refunds sent",
        direction: "out",
        amountPoisha: cashRefundsSentPoisha,
        recordCount: cashRefundCount,
      },
    ],
    cashInPoisha,
    cashRefundsSentPoisha,
    expectedCashPoisha: openingCashPoisha + cashInPoisha - cashRefundsSentPoisha,
    exclusionsBn: [
      "কুরিয়ারের কাছে থাকা COD এই হিসাবে নেই — সেটি রেমিট্যান্স লেজারের বিষয়, ড্রয়ারের নগদ নয়।",
      "বিকাশ/নগদ/গেটওয়ে পেমেন্ট ইলেকট্রনিক — নিজ নিজ চ্যানেলে আলাদা মেলানো হয়।",
    ],
  };
}

export interface DerivedClosingInput {
  date: string;
  countedCashPoisha: number;
  /** Physical opening count override; defaults to the derived one. */
  openingCashPoisha?: number;
  bkash: CashChannelInput;
  nagad: CashChannelInput;
  courierCodReceivable: CashChannelInput;
  customerDuePoisha?: number;
  tolerancePoisha?: number;
}

export interface DerivedClosingResult {
  derived: DerivedDrawerCash;
  closing: DailyCashClosing;
}

/**
 * Build the day's closing with the cash channel FULLY derived: the
 * calculator's hand-typed cash components (sales / refunds / expenses
 * / deposits) are replaced by the derived in/out figures, so the one
 * buildDailyCashClosing() computation path still produces the closing
 * and its channel table. Expenses/deposits enter as 0 — no records
 * exist for them (see the module header).
 */
export async function buildDerivedClosing(
  input: DerivedClosingInput,
): Promise<DerivedClosingResult> {
  const derived = await deriveDrawerCash(input.date);
  const openingCashPoisha = input.openingCashPoisha ?? derived.openingCashPoisha;
  const closing = buildDailyCashClosing({
    date: input.date,
    openingCashPoisha,
    cashSalesPoisha: derived.cashInPoisha,
    cashRefundsPoisha: derived.cashRefundsSentPoisha,
    expensesPoisha: 0,
    cashDepositedPoisha: 0,
    countedCashPoisha: input.countedCashPoisha,
    bkash: input.bkash,
    nagad: input.nagad,
    courierCodReceivable: input.courierCodReceivable,
    customerDuePoisha: input.customerDuePoisha ?? 0,
    tolerancePoisha: input.tolerancePoisha ?? 0,
  });
  return {
    derived: { ...derived, openingCashPoisha, expectedCashPoisha: closing.expectedCashPoisha },
    closing,
  };
}
