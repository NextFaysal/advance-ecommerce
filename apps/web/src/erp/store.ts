// ERP store — Agent 17 interface, DB-backed since 2026-10-24.
//
// Persistence lives behind this interface; the runtime store is
// PrismaErpStore in ./db-store.ts (shared instance: `erpStore`, used by
// the ERP journal API route). The in-memory implementation stays for
// tests/fixtures. The interface is async: the previous contract was
// the journal route's module-local arrays.
//
// Immutability is structural: the interface has NO update or delete
// for entries. A posted entry can only ever be corrected by appending
// a reversal (buildReversalEntry in ledger.ts).
//
// This file must NEVER import Prisma (client-bundle safety).
import { DEFAULT_CHART_OF_ACCOUNTS } from "./accounts";
import type { Account, AccountingPeriod, JournalEntry } from "./types";

/** A journal line referenced an account code that does not exist. */
export class UnknownAccountError extends Error {
  constructor(code: string) {
    super(`Unknown account code: ${code}.`);
    this.name = "UnknownAccountError";
  }
}

export interface ErpStore {
  listAccounts(): Promise<Account[]>;
  listEntries(): Promise<JournalEntry[]>;
  /** Persist a built (and usually already posted) entry. Throws
   *  UnbalancedEntryError on an unbalanced entry and
   *  PeriodLockedError when its date falls in a locked period —
   *  defense in depth behind ledger.ts's own checks. */
  appendEntry(entry: JournalEntry): Promise<JournalEntry>;
  listPeriods(): Promise<AccountingPeriod[]>;
  lockPeriod(period: string, lockedById: string, now: Date): Promise<AccountingPeriod>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryErpStore implements ErpStore {
  private entries: JournalEntry[] = [];
  private periods: AccountingPeriod[] = [];

  async listAccounts(): Promise<Account[]> {
    return DEFAULT_CHART_OF_ACCOUNTS;
  }
  async listEntries(): Promise<JournalEntry[]> { return [...this.entries]; }
  async appendEntry(entry: JournalEntry): Promise<JournalEntry> {
    this.entries.push(entry);
    return entry;
  }
  async listPeriods(): Promise<AccountingPeriod[]> { return [...this.periods]; }
  async lockPeriod(period: string, lockedById: string, now: Date): Promise<AccountingPeriod> {
    const existing = this.periods.find((p) => p.period === period);
    if (existing) {
      existing.isLocked = true;
      existing.lockedAt = now.toISOString();
      existing.lockedById = lockedById;
      return existing;
    }
    const created: AccountingPeriod = {
      period, isLocked: true, lockedAt: now.toISOString(), lockedById,
    };
    this.periods.push(created);
    return created;
  }
}
