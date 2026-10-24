/**
 * Ledger — Agent 17, Step 49 (A16).
 *
 * The rules that keep the books honest:
 *  1. An entry is created ONLY through buildJournalEntry(), which throws
 *     on: a one-sided-line violation (both debit and credit > 0, or both
 *     0), fewer than 2 lines, or total debits ≠ total credits. Unbalanced
 *     entries are rejected, never "fixed" by adding a plug line.
 *  2. Posted entries are immutable. Corrections happen by reversal
 *     (buildReversalEntry) — the original flips to "reversed".
 *  3. A locked accounting period refuses new entries dated inside it.
 * Expenses and supplier payments are just typed entry builders on top
 * of the same rule — they cannot bypass balancing or the period lock.
 */
import type {
  AccountBalance,
  AccountingPeriod,
  ExpenseInput,
  JournalEntry,
  JournalEntryInput,
  SupplierPaymentInput,
} from "./types";

export class UnbalancedEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnbalancedEntryError";
  }
}

export class PeriodLockedError extends Error {
  constructor(period: string) {
    super(`Accounting period ${period} is locked.`);
    this.name = "PeriodLockedError";
  }
}

export function periodOf(date: string): string {
  return date.slice(0, 7); // "YYYY-MM"
}

export function isPeriodLocked(periods: AccountingPeriod[], date: string): boolean {
  const period = periods.find((p) => p.period === periodOf(date));
  return period?.isLocked ?? false;
}

let entrySeq = 0;
function nextEntryId(): string {
  entrySeq += 1;
  return `je-demo-${entrySeq}`;
}

export function buildJournalEntry(input: JournalEntryInput, now: Date): JournalEntry {
  if (input.lines.length < 2) {
    throw new UnbalancedEntryError("A journal entry needs at least two lines.");
  }
  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of input.lines) {
    if (!Number.isInteger(line.debitPoisha) || !Number.isInteger(line.creditPoisha)) {
      throw new UnbalancedEntryError("Journal amounts must be integer poisha.");
    }
    if (line.debitPoisha > 0 && line.creditPoisha > 0) {
      throw new UnbalancedEntryError("A journal line cannot have both a debit and a credit.");
    }
    if (line.debitPoisha === 0 && line.creditPoisha === 0) {
      throw new UnbalancedEntryError("A journal line cannot be zero on both sides.");
    }
    totalDebit += line.debitPoisha;
    totalCredit += line.creditPoisha;
  }
  if (totalDebit !== totalCredit) {
    throw new UnbalancedEntryError(
      `Unbalanced entry: debits ${totalDebit} poisha ≠ credits ${totalCredit} poisha.`,
    );
  }
  return {
    id: nextEntryId(),
    date: input.date,
    description: input.description,
    lines: input.lines.map((l) => ({ ...l })),
    status: "draft",
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    reversesEntryId: null,
    createdAt: now.toISOString(),
  };
}

/** Post an entry, refusing when its date falls in a locked period. */
export function postEntry(
  entry: JournalEntry,
  periods: AccountingPeriod[],
): JournalEntry {
  if (entry.status !== "draft") throw new Error("Only a draft entry can be posted.");
  if (isPeriodLocked(periods, entry.date)) throw new PeriodLockedError(periodOf(entry.date));
  return { ...entry, status: "posted" };
}

/** Build the mirror entry that reverses a posted entry (same date rules apply on post). */
export function buildReversalEntry(original: JournalEntry, date: string, now: Date): JournalEntry {
  if (original.status !== "posted") throw new Error("Only a posted entry can be reversed.");
  const reversal = buildJournalEntry(
    {
      date,
      description: `Reversal of ${original.id}: ${original.description}`,
      lines: original.lines.map((l) => ({
        accountCode: l.accountCode,
        debitPoisha: l.creditPoisha,
        creditPoisha: l.debitPoisha,
        memo: l.memo,
      })),
      sourceKind: "reversal",
      sourceId: original.id,
    },
    now,
  );
  return { ...reversal, reversesEntryId: original.id };
}

/** Expense: Dr expense (+ Dr VAT input when vatPoisha > 0), Cr paid-from. */
export function buildExpenseEntry(expense: ExpenseInput, now: Date): JournalEntry {
  const lines = [
    { accountCode: expense.expenseAccountCode, debitPoisha: expense.amountPoisha, creditPoisha: 0 },
    ...(expense.vatPoisha > 0
      ? [{ accountCode: "2100", debitPoisha: expense.vatPoisha, creditPoisha: 0, memo: "Input VAT" }]
      : []),
    {
      accountCode: expense.paidFromAccountCode,
      debitPoisha: 0,
      creditPoisha: expense.amountPoisha + expense.vatPoisha,
    },
  ];
  return buildJournalEntry(
    { date: expense.date, description: expense.description, lines, sourceKind: "expense", sourceId: null },
    now,
  );
}

/** Supplier payment: Dr accounts payable, Cr paid-from. */
export function buildSupplierPaymentEntry(payment: SupplierPaymentInput, now: Date): JournalEntry {
  return buildJournalEntry(
    {
      date: payment.date,
      description: `Supplier payment (${payment.supplierId})`,
      lines: [
        { accountCode: payment.payableAccountCode, debitPoisha: payment.amountPoisha, creditPoisha: 0 },
        { accountCode: payment.paidFromAccountCode, debitPoisha: 0, creditPoisha: payment.amountPoisha },
      ],
      sourceKind: "supplier_payment",
      sourceId: payment.purchaseOrderId,
    },
    now,
  );
}

/** Trial-balance style balances over POSTED entries only. */
export function accountBalances(entries: JournalEntry[]): AccountBalance[] {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    for (const line of entry.lines) {
      const current = byAccount.get(line.accountCode) ?? { debit: 0, credit: 0 };
      current.debit += line.debitPoisha;
      current.credit += line.creditPoisha;
      byAccount.set(line.accountCode, current);
    }
  }
  return [...byAccount.entries()]
    .map(([accountCode, v]) => ({
      accountCode,
      debitPoisha: v.debit,
      creditPoisha: v.credit,
      balancePoisha: v.debit - v.credit,
    }))
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
}

export function lockPeriod(periods: AccountingPeriod[], period: string, lockedById: string, now: Date): AccountingPeriod[] {
  return periods.map((p) =>
    p.period === period
      ? { ...p, isLocked: true, lockedAt: now.toISOString(), lockedById }
      : p,
  );
}
