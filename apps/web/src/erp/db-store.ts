/**
 * Prisma-backed ERP store — DB-backed since 2026-10-24.
 *
 * Server-only (imports the Prisma client): the ERP journal API route
 * imports this file directly; src/erp/store.ts stays Prisma-free.
 *
 * INVARIANTS PRESERVED: entries are append-only here too (no update /
 * delete path exists); appendEntry re-verifies the balance and the
 * period lock against the DB before writing, so a caller that skipped
 * ledger.ts's builders still cannot land an unbalanced entry or post
 * into a locked period. The default chart of accounts is upserted by
 * code on first use (ErpJournalLine.accountId is a real FK).
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - ErpAccount has no parentCode / isActive columns: reads return
 *    parentCode null and isActive true (the default chart's values).
 *  - ErpJournalLine has no memo column: line memos are accepted on
 *    write and absent on read-back.
 *  - ErpJournalEntry has no reversesEntryId column: a reversal's link
 *    survives as sourceKind "reversal" + sourceId = original id, and
 *    reads reconstruct reversesEntryId from exactly that pair.
 *  - ErpPeriod has no lockedById column: reads return lockedById null.
 *    Period startsOn / endsOn are derived from the "YYYY-MM" code.
 *  - Entry status is a free String column; TS values (draft / posted /
 *    reversed) are stored verbatim.
 *  - Local builder ids ("je-demo-N") are NOT used as row ids (the
 *    counter resets per process and would collide): rows get cuids
 *    and appendEntry returns the stored record.
 */
import { prisma } from "@advance-ecommerce/db";
import { DEFAULT_CHART_OF_ACCOUNTS } from "./accounts";
import { PeriodLockedError, UnbalancedEntryError, periodOf } from "./ledger";
import { UnknownAccountError, type ErpStore } from "./store";
import type { Account, AccountingPeriod, JournalEntry } from "./types";

type EntryRow = Awaited<ReturnType<typeof prisma.erpJournalEntry.findMany>>[number];
type EntryRowWithLines = EntryRow & {
  lines: Array<{ account: { code: string }; debitPoisha: number; creditPoisha: number }>;
};
type PeriodRow = Awaited<ReturnType<typeof prisma.erpPeriod.findMany>>[number];

function rowToPeriod(row: PeriodRow): AccountingPeriod {
  return {
    period: row.code,
    isLocked: row.lockedAt !== null,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    lockedById: null, // not persisted — see header
  };
}

function rowToEntry(row: EntryRowWithLines): JournalEntry {
  return {
    id: row.id,
    date: row.entryDate.toISOString().slice(0, 10),
    description: row.memo ?? "",
    lines: row.lines.map((l) => ({
      accountCode: l.account.code,
      debitPoisha: l.debitPoisha,
      creditPoisha: l.creditPoisha,
    })),
    status: (["draft", "posted", "reversed"].includes(row.status)
      ? row.status
      : "draft") as JournalEntry["status"],
    sourceKind: row.sourceKind ?? "manual",
    sourceId: row.sourceId,
    reversesEntryId: row.sourceKind === "reversal" ? row.sourceId : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaErpStore implements ErpStore {
  private accountsReady: Promise<void> | null = null;

  /** Upsert the default chart once per process (codes are unique). */
  private ensureAccounts(): Promise<void> {
    if (!this.accountsReady) {
      this.accountsReady = (async () => {
        for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
          await prisma.erpAccount.upsert({
            where: { code: account.code },
            update: {},
            create: { code: account.code, nameBn: account.nameBn, nameEn: account.nameEn, type: account.type },
          });
        }
      })();
    }
    return this.accountsReady;
  }

  async listAccounts(): Promise<Account[]> {
    await this.ensureAccounts();
    const rows = await prisma.erpAccount.findMany({ orderBy: { code: "asc" } });
    return rows.map((r) => ({
      code: r.code,
      nameEn: r.nameEn,
      nameBn: r.nameBn,
      type: r.type as Account["type"],
      parentCode: null,
      isActive: true,
    }));
  }

  async listEntries(): Promise<JournalEntry[]> {
    const rows = await prisma.erpJournalEntry.findMany({
      orderBy: { createdAt: "asc" },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    return rows.map(rowToEntry);
  }

  async appendEntry(entry: JournalEntry): Promise<JournalEntry> {
    const totalDebit = entry.lines.reduce((s, l) => s + l.debitPoisha, 0);
    const totalCredit = entry.lines.reduce((s, l) => s + l.creditPoisha, 0);
    if (totalDebit !== totalCredit) {
      throw new UnbalancedEntryError(
        `Unbalanced entry: debits ${totalDebit} poisha ≠ credits ${totalCredit} poisha.`,
      );
    }
    const periodCode = periodOf(entry.date);
    const period = await prisma.erpPeriod.findUnique({ where: { code: periodCode } });
    if (period?.lockedAt) throw new PeriodLockedError(periodCode);

    await this.ensureAccounts();
    const codes = [...new Set(entry.lines.map((l) => l.accountCode))];
    const accounts = await prisma.erpAccount.findMany({ where: { code: { in: codes } } });
    const idByCode = new Map(accounts.map((a) => [a.code, a.id]));
    for (const code of codes) {
      if (!idByCode.has(code)) throw new UnknownAccountError(code);
    }

    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.erpJournalEntry.create({
        data: {
          entryDate: new Date(entry.date),
          memo: entry.description,
          sourceKind: entry.sourceKind,
          sourceId: entry.sourceId,
          status: entry.status,
          periodCode,
        },
      });
      for (const line of entry.lines) {
        await tx.erpJournalLine.create({
          data: {
            entryId: created.id,
            accountId: idByCode.get(line.accountCode) as string,
            debitPoisha: line.debitPoisha,
            creditPoisha: line.creditPoisha,
          },
        });
      }
      return tx.erpJournalEntry.findUniqueOrThrow({
        where: { id: created.id },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });
    });
    return rowToEntry(row);
  }

  async listPeriods(): Promise<AccountingPeriod[]> {
    const rows = await prisma.erpPeriod.findMany({ orderBy: { code: "asc" } });
    return rows.map(rowToPeriod);
  }

  async lockPeriod(period: string, _lockedById: string, now: Date): Promise<AccountingPeriod> {
    const [year, month] = period.split("-").map(Number);
    const startsOn = new Date(Date.UTC(year as number, (month as number) - 1, 1));
    const endsOn = new Date(Date.UTC(year as number, month as number, 0));
    const row = await prisma.erpPeriod.upsert({
      where: { code: period },
      update: { lockedAt: now },
      create: { code: period, startsOn, endsOn, lockedAt: now },
    });
    return rowToPeriod(row);
  }
}

/** Shared Prisma instance used by the ERP journal API route. */
export const erpStore: ErpStore = new PrismaErpStore();
