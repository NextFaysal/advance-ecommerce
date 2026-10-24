import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  PeriodLockedError,
  UnbalancedEntryError,
  accountBalances,
  buildJournalEntry,
  postEntry,
} from "@/erp/ledger";
import { erpStore } from "@/erp/db-store";
import { UnknownAccountError } from "@/erp/store";
import { journalEntryInputSchema } from "@/erp/types";

// ERP-lite journal — Agent 17, Step 49 (A16). RBAC: reports.accounting.
// DB-backed (Prisma) since 2026-10-24: entries and periods live in the
// ErpJournalEntry / ErpJournalLine / ErpPeriod tables. Unbalanced
// entries are rejected by the ledger builder itself (400
// UNBALANCED_ENTRY) — and re-verified by the store — and locked
// periods refuse posting (409 PERIOD_LOCKED). Posted entries are
// immutable: the store exposes no update/delete path.
export async function GET() {
  const guard = await requireAdmin("reports.accounting");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const entries = await erpStore.listEntries();
  const periods = await erpStore.listPeriods();
  return NextResponse.json({
    data: { entries, balances: accountBalances(entries), periods },
    meta: { persistence: "database" },
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
    const periods = await erpStore.listPeriods();
    const posted = postEntry(buildJournalEntry(parsed.data, new Date()), periods);
    const entry = await erpStore.appendEntry(posted);
    return NextResponse.json({ data: { entry }, meta: { persistence: "database" } }, { status: 201 });
  } catch (err) {
    if (err instanceof UnbalancedEntryError) {
      return NextResponse.json({ error: { code: "UNBALANCED_ENTRY", message: err.message } }, { status: 400 });
    }
    if (err instanceof PeriodLockedError) {
      return NextResponse.json({ error: { code: "PERIOD_LOCKED", message: err.message } }, { status: 409 });
    }
    if (err instanceof UnknownAccountError) {
      return NextResponse.json({ error: { code: "INVALID_INPUT", message: err.message } }, { status: 400 });
    }
    throw err;
  }
}
