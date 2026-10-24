import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  PeriodLockedError,
  UnbalancedEntryError,
  accountBalances,
  buildJournalEntry,
  postEntry,
} from "@/erp/ledger";
import { journalEntryInputSchema, type AccountingPeriod, type JournalEntry } from "@/erp/types";

// ERP-lite journal — Agent 17, Step 49 (A16). RBAC: reports.accounting.
// In-memory demo ledger; unbalanced entries are rejected by the ledger
// builder itself (400 UNBALANCED_ENTRY) and locked periods refuse posting
// (409 PERIOD_LOCKED). Swap point: persist posted entries to the journal
// tables proposed in docs/MODULES.md.
const demoEntries: JournalEntry[] = [];
const demoPeriods: AccountingPeriod[] = [];

export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({
    data: { entries: demoEntries, balances: accountBalances(demoEntries), periods: demoPeriods },
    meta: { persistence: "in-memory-demo" },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = journalEntryInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid journal entry.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const entry = postEntry(buildJournalEntry(parsed.data, new Date()), demoPeriods);
    demoEntries.push(entry);
    return NextResponse.json({ data: { entry }, meta: { persistence: "in-memory-demo" } }, { status: 201 });
  } catch (err) {
    if (err instanceof UnbalancedEntryError) {
      return NextResponse.json({ error: { code: "UNBALANCED_ENTRY", message: err.message } }, { status: 400 });
    }
    if (err instanceof PeriodLockedError) {
      return NextResponse.json({ error: { code: "PERIOD_LOCKED", message: err.message } }, { status: 409 });
    }
    throw err;
  }
}
