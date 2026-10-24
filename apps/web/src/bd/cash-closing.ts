/**
 * Daily cash closing — Agent 11, Step 45 (E4). Pure logic, integer poisha.
 *
 * At the end of the day the shop must answer one question per channel:
 * "jototuku thakar kotha, tot-tukui ki ache?" — expected vs actual, for
 * physical cash, bKash, Nagad, and courier COD receivable (money couriers
 * collected on delivered COD orders but have not settled yet).
 *
 * Rules:
 *  - Every amount is integer poisha; no float ever enters this module.
 *  - A channel mismatches when actual !== expected (zero tolerance by
 *    default; a caller may pass a tolerance, which is then reported).
 *  - A mismatch is FLAGGED, never auto-corrected: closingCash is computed
 *    from EXPECTED cash movements minus what was deposited, and the
 *    difference is reported as its own number so the accountant sees it.
 *  - Customer ledger (khata) due is reported as a memo line — it is money
 *    owed BY customers, not money in hand, so it never enters totals.
 *
 * Test case (all poisha):
 *  opening 100000, cashSales 500000, cashRefunds 20000, expenses 30000,
 *  deposited 400000 -> closingCash 150000.
 *  bKash expected 250000, actual 249000 -> difference -1000, mismatch.
 *  courierCod expected receivable 800000, received 800000 -> matched.
 *  Result: hasMismatch === true, mismatchChannels === ["bkash"].
 */
import { z } from "zod";

export const cashChannelInputSchema = z.object({
  /** What the day's records say this channel should hold / have received. */
  expectedPoisha: z.number().int().nonnegative(),
  /** What was actually counted / seen in the statement. */
  actualPoisha: z.number().int().nonnegative(),
});

export type CashChannelInput = z.infer<typeof cashChannelInputSchema>;

export const dailyCashClosingInputSchema = z.object({
  /** yyyy-mm-dd, Asia/Dhaka business day. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  openingCashPoisha: z.number().int().nonnegative(),
  cashSalesPoisha: z.number().int().nonnegative(),
  cashRefundsPoisha: z.number().int().nonnegative(),
  expensesPoisha: z.number().int().nonnegative(),
  /** Cash taken out of the drawer to the bank / owner during the day. */
  cashDepositedPoisha: z.number().int().nonnegative().default(0),
  /** Actual physical cash counted in the drawer at closing. */
  countedCashPoisha: z.number().int().nonnegative(),
  bkash: cashChannelInputSchema,
  nagad: cashChannelInputSchema,
  /** COD money couriers owe for delivered orders vs what they settled today. */
  courierCodReceivable: cashChannelInputSchema,
  /** Memo only: total customer khata due at end of day. Never totalled. */
  customerDuePoisha: z.number().int().nonnegative().default(0),
  tolerancePoisha: z.number().int().nonnegative().default(0),
});

export type DailyCashClosingInput = z.infer<typeof dailyCashClosingInputSchema>;

export type CashChannelName = "cash" | "bkash" | "nagad" | "courier_cod";

export interface ChannelClosing {
  channel: CashChannelName;
  expectedPoisha: number;
  actualPoisha: number;
  differencePoisha: number;
  mismatch: boolean;
}

export interface DailyCashClosing {
  date: string;
  /** Expected drawer cash at closing, before counting. */
  expectedCashPoisha: number;
  countedCashPoisha: number;
  cashDifferencePoisha: number;
  channels: ChannelClosing[];
  totalExpectedPoisha: number;
  totalActualPoisha: number;
  totalDifferencePoisha: number;
  hasMismatch: boolean;
  mismatchChannels: CashChannelName[];
  /** Memo only — not in any total. */
  customerDuePoisha: number;
  tolerancePoisha: number;
}

function closeChannel(
  channel: CashChannelName,
  expectedPoisha: number,
  actualPoisha: number,
  tolerancePoisha: number,
): ChannelClosing {
  const differencePoisha = actualPoisha - expectedPoisha;
  return {
    channel,
    expectedPoisha,
    actualPoisha,
    differencePoisha,
    mismatch: Math.abs(differencePoisha) > tolerancePoisha,
  };
}

export function buildDailyCashClosing(raw: unknown): DailyCashClosing {
  const input = dailyCashClosingInputSchema.parse(raw);
  const expectedCashPoisha =
    input.openingCashPoisha +
    input.cashSalesPoisha -
    input.cashRefundsPoisha -
    input.expensesPoisha -
    input.cashDepositedPoisha;

  const channels: ChannelClosing[] = [
    closeChannel("cash", expectedCashPoisha, input.countedCashPoisha, input.tolerancePoisha),
    closeChannel("bkash", input.bkash.expectedPoisha, input.bkash.actualPoisha, input.tolerancePoisha),
    closeChannel("nagad", input.nagad.expectedPoisha, input.nagad.actualPoisha, input.tolerancePoisha),
    closeChannel(
      "courier_cod",
      input.courierCodReceivable.expectedPoisha,
      input.courierCodReceivable.actualPoisha,
      input.tolerancePoisha,
    ),
  ];

  const totalExpectedPoisha = channels.reduce((s, c) => s + c.expectedPoisha, 0);
  const totalActualPoisha = channels.reduce((s, c) => s + c.actualPoisha, 0);
  const mismatchChannels = channels.filter((c) => c.mismatch).map((c) => c.channel);

  return {
    date: input.date,
    expectedCashPoisha,
    countedCashPoisha: input.countedCashPoisha,
    cashDifferencePoisha: input.countedCashPoisha - expectedCashPoisha,
    channels,
    totalExpectedPoisha,
    totalActualPoisha,
    totalDifferencePoisha: totalActualPoisha - totalExpectedPoisha,
    hasMismatch: mismatchChannels.length > 0,
    mismatchChannels,
    customerDuePoisha: input.customerDuePoisha,
    tolerancePoisha: input.tolerancePoisha,
  };
}
