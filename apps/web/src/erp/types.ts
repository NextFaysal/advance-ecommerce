/**
 * ERP-lite types — Agent 17, Execution Plan Step 49 (A16).
 *
 * Double-entry accounting, deliberately small: chart of accounts,
 * journal entries, expenses, supplier payments, VAT aggregation, and
 * accounting periods with locks. EVERY amount is integer poisha and
 * every journal line is one-sided (debit XOR credit). An entry whose
 * total debits ≠ total credits is rejected at construction — there is
 * no code path that creates an unbalanced entry (see ledger.ts).
 */
import { z } from "zod";

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accountSchema = z.object({
  /** Ledger code, e.g. "1000" cash, "4000" sales revenue. */
  code: z.string().regex(/^\d{3,6}$/),
  nameEn: z.string().min(1).max(120),
  nameBn: z.string().min(1).max(120),
  type: z.enum(ACCOUNT_TYPES),
  /** Sub-accounts roll up to their parent code. */
  parentCode: z.string().regex(/^\d{3,6}$/).nullable().default(null),
  isActive: z.boolean().default(true),
});

export type Account = z.infer<typeof accountSchema>;

/* ------------------------------------------------------------------ */
/* Journal                                                             */
/* ------------------------------------------------------------------ */

export const journalLineSchema = z.object({
  accountCode: z.string().regex(/^\d{3,6}$/),
  /** Integer poisha; exactly one of debit/credit is > 0, the other is 0. */
  debitPoisha: z.number().int().min(0),
  creditPoisha: z.number().int().min(0),
  memo: z.string().max(200).optional(),
});

export type JournalLine = z.infer<typeof journalLineSchema>;

export type JournalEntryStatus = "draft" | "posted" | "reversed";

export interface JournalEntry {
  id: string;
  /** Business date, "YYYY-MM-DD" (Asia/Dhaka). */
  date: string;
  description: string;
  lines: JournalLine[];
  status: JournalEntryStatus;
  /** Source document, e.g. { kind: "order", id } / { kind: "expense", id }. */
  sourceKind: string;
  sourceId: string | null;
  /** Set when this entry reverses another (status of the original becomes "reversed"). */
  reversesEntryId: string | null;
  createdAt: string; // ISO
}

export const journalEntryInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1).max(300),
  lines: z.array(journalLineSchema).min(2, "A journal entry needs at least two lines."),
  sourceKind: z.string().min(1).max(40).default("manual"),
  sourceId: z.string().nullable().default(null),
});

export type JournalEntryInput = z.infer<typeof journalEntryInputSchema>;

/* ------------------------------------------------------------------ */
/* Expenses + supplier payments                                        */
/* ------------------------------------------------------------------ */

export const expenseInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Expense account code (type "expense"). */
  expenseAccountCode: z.string().regex(/^\d{3,6}$/),
  /** Paid-from account code (asset, e.g. cash / bank / bKash). */
  paidFromAccountCode: z.string().regex(/^\d{3,6}$/),
  amountPoisha: z.number().int().positive(),
  vatPoisha: z.number().int().min(0).default(0),
  description: z.string().min(1).max(300),
});

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const supplierPaymentInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplierId: z.string().min(1),
  /** Accounts-payable liability account code. */
  payableAccountCode: z.string().regex(/^\d{3,6}$/),
  paidFromAccountCode: z.string().regex(/^\d{3,6}$/),
  amountPoisha: z.number().int().positive(),
  purchaseOrderId: z.string().nullable().default(null),
});

export type SupplierPaymentInput = z.infer<typeof supplierPaymentInputSchema>;

/* ------------------------------------------------------------------ */
/* VAT + periods                                                       */
/* ------------------------------------------------------------------ */

/** One sales/purchase row feeding the VAT report. Amounts in poisha. */
export interface VatRow {
  /** "YYYY-MM-DD". */
  date: string;
  kind: "sale" | "purchase";
  netPoisha: number;
  vatPoisha: number;
  /** VAT rate in basis points (1500 = 15%). */
  vatRateBps: number;
}

export interface VatReport {
  fromDate: string;
  toDate: string;
  outputVatPoisha: number; // VAT collected on sales
  inputVatPoisha: number; // VAT paid on purchases (claimable)
  /** output − input; positive = payable to NBR, negative = credit carried forward. */
  netPayablePoisha: number;
  salesNetPoisha: number;
  purchaseNetPoisha: number;
  byRate: Array<{ vatRateBps: number; salesVatPoisha: number; purchaseVatPoisha: number }>;
}

export interface AccountingPeriod {
  /** "YYYY-MM". */
  period: string;
  isLocked: boolean;
  lockedAt: string | null; // ISO
  lockedById: string | null;
}

export interface AccountBalance {
  accountCode: string;
  debitPoisha: number;
  creditPoisha: number;
  /** debit − credit (positive = debit balance). */
  balancePoisha: number;
}
