/**
 * Fraud list store — Agent 13 interface, DB-backed since 2026-10-24.
 *
 * Persistence lives behind this interface; the runtime store is
 * PrismaFraudListStore over the FraudListEntry table (shared instance:
 * `fraudListStore`, used by the fraud-rules API routes and — via
 * snapshot() — by checkout's assembleFraudInput, so scoreFraud() scores
 * against the DB lists). The in-memory implementation stays for tests
 * and page fixtures. The interface is async: the previous sync contract
 * was the demo store's shape, and every runtime consumer is async.
 *
 * Matching rules (deterministic, documented — no fuzzy free-text matching):
 *  - phone entries match on the normalized phone, exact.
 *  - address entries match on district, case-insensitive exact after trim.
 *
 * SCHEMA DRIFT (reported, worked around — schema.prisma NOT changed):
 *  - FraudListEntry has no createdBy column: accepted on write, never
 *    persisted, absent on read-back (same treatment as staff invites).
 *  - The table's @@unique([listType, entryType, value]) makes `add` an
 *    UPSERT: re-adding the same phone/district to the same list updates
 *    reason/district on the existing row and returns it, instead of the
 *    duplicate rows the in-memory store allowed. The unique constraint
 *    is the backstop; two entries for one value in one list can never
 *    disagree about which reason applies.
 *  - reason is nullable in the schema, required in the TS type: a row
 *    with a NULL reason (only writable outside this store) reads back
 *    with reason "".
 */
import { prisma } from "@advance-ecommerce/db";
import type { FraudListEntry, FraudLists } from "./types";

export type FraudListName = "blacklist" | "whitelist";

export interface FraudListStore {
  list(kind: FraudListName): Promise<FraudListEntry[]>;
  add(kind: FraudListName, entry: FraudListEntry): Promise<FraudListEntry>;
  remove(id: string): Promise<boolean>;
  snapshot(): Promise<FraudLists>;
}

/* ------------------------------------------------------------------ */
/* In-memory implementation (tests / fixtures)                          */
/* ------------------------------------------------------------------ */

export class InMemoryFraudListStore implements FraudListStore {
  private byList: Record<FraudListName, FraudListEntry[]> = {
    blacklist: [],
    whitelist: [],
  };

  constructor(seed: Partial<FraudLists> = {}) {
    this.byList.blacklist = (seed.blacklist ?? []).map((e) => ({ ...e }));
    this.byList.whitelist = (seed.whitelist ?? []).map((e) => ({ ...e }));
  }

  async list(kind: FraudListName): Promise<FraudListEntry[]> {
    return this.byList[kind].map((e) => ({ ...e }));
  }

  async add(kind: FraudListName, entry: FraudListEntry): Promise<FraudListEntry> {
    this.byList[kind].push({ ...entry });
    return { ...entry };
  }

  async remove(id: string): Promise<boolean> {
    for (const kind of ["blacklist", "whitelist"] as const) {
      const before = this.byList[kind].length;
      this.byList[kind] = this.byList[kind].filter((e) => e.id !== id);
      if (this.byList[kind].length < before) return true;
    }
    return false;
  }

  async snapshot(): Promise<FraudLists> {
    return { blacklist: await this.list("blacklist"), whitelist: await this.list("whitelist") };
  }
}

/* ------------------------------------------------------------------ */
/* Prisma implementation (runtime)                                      */
/* ------------------------------------------------------------------ */

interface FraudListRowShape {
  id: string;
  entryType: string;
  value: string;
  district: string | null;
  reason: string | null;
  createdAt: Date;
}

function rowToEntry(row: FraudListRowShape): FraudListEntry {
  return {
    id: row.id,
    kind: row.entryType as FraudListEntry["kind"],
    value: row.value,
    ...(row.district ? { district: row.district } : {}),
    reason: row.reason ?? "",
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaFraudListStore implements FraudListStore {
  async list(kind: FraudListName): Promise<FraudListEntry[]> {
    const rows = await prisma.fraudListEntry.findMany({
      where: { listType: kind },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(rowToEntry);
  }

  async add(kind: FraudListName, entry: FraudListEntry): Promise<FraudListEntry> {
    const row = await prisma.fraudListEntry.upsert({
      where: {
        listType_entryType_value: {
          listType: kind,
          entryType: entry.kind,
          value: entry.value,
        },
      },
      create: {
        id: entry.id,
        listType: kind,
        entryType: entry.kind,
        value: entry.value,
        district: entry.district ?? null,
        reason: entry.reason,
      },
      update: {
        district: entry.district ?? null,
        reason: entry.reason,
      },
    });
    return rowToEntry(row);
  }

  async remove(id: string): Promise<boolean> {
    try {
      await prisma.fraudListEntry.delete({ where: { id } });
      return true;
    } catch (err) {
      // P2025 = record not found: removing a missing entry is a miss,
      // exactly like the in-memory store's filter finding nothing.
      if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2025") {
        return false;
      }
      throw err;
    }
  }

  async snapshot(): Promise<FraudLists> {
    const [blacklist, whitelist] = await Promise.all([
      this.list("blacklist"),
      this.list("whitelist"),
    ]);
    return { blacklist, whitelist };
  }
}

/** Shared DB-backed store used by the fraud-rules API routes and by
 *  checkout fraud scoring (via assembleFraudInput's snapshot). */
export const fraudListStore: FraudListStore = new PrismaFraudListStore();

/* ------------------------------------------------------------------ */
/* Matching helpers (pure — used by the scorer against a snapshot)      */
/* ------------------------------------------------------------------ */

/** Exact phone match (normalized values on both sides). */
export function matchesPhoneEntry(entry: FraudListEntry, normalizedPhone: string): boolean {
  return entry.kind === "phone" && entry.value === normalizedPhone;
}

/** District match for address entries, case-insensitive after trim. */
export function matchesAddressEntry(entry: FraudListEntry, district: string): boolean {
  if (entry.kind !== "address") return false;
  const target = (entry.district ?? entry.value).trim().toLowerCase();
  return target !== "" && target === district.trim().toLowerCase();
}

/** IP match for IP entries, case-insensitive after trim. */
export function matchesIpEntry(entry: FraudListEntry, ip?: string): boolean {
  if (entry.kind !== "ip" || !ip || ip === "unknown") return false;
  return entry.value.trim().toLowerCase() === ip.trim().toLowerCase();
}

export function findBlacklistHit(
  lists: FraudLists,
  input: { phone: string; district: string; ip?: string },
): FraudListEntry | undefined {
  return lists.blacklist.find(
    (e) =>
      matchesPhoneEntry(e, input.phone) ||
      matchesAddressEntry(e, input.district) ||
      matchesIpEntry(e, input.ip),
  );
}

export function isWhitelisted(
  lists: FraudLists,
  input: { phone: string; district: string; ip?: string },
): boolean {
  return lists.whitelist.some(
    (e) =>
      matchesPhoneEntry(e, input.phone) ||
      matchesAddressEntry(e, input.district) ||
      matchesIpEntry(e, input.ip),
  );
}
