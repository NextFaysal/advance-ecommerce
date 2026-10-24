/**
 * Fraud list store — Agent 13. Persistence behind an explicit interface.
 * Default: in-memory (non-persistent, labelled as such by the API routes).
 * A Prisma-backed store must implement the same interface against
 * Blacklist/Whitelist tables — PENDING the DB-owner schema proposal.
 *
 * Matching rules (deterministic, documented — no fuzzy free-text matching):
 *  - phone entries match on the normalized phone, exact.
 *  - address entries match on district, case-insensitive exact after trim.
 */
import type { FraudListEntry, FraudLists } from "./types";

export type FraudListName = "blacklist" | "whitelist";

export interface FraudListStore {
  list(kind: FraudListName): FraudListEntry[];
  add(kind: FraudListName, entry: FraudListEntry): FraudListEntry;
  remove(id: string): boolean;
  snapshot(): FraudLists;
}

export class InMemoryFraudListStore implements FraudListStore {
  private byList: Record<FraudListName, FraudListEntry[]> = {
    blacklist: [],
    whitelist: [],
  };

  constructor(seed: Partial<FraudLists> = {}) {
    this.byList.blacklist = (seed.blacklist ?? []).map((e) => ({ ...e }));
    this.byList.whitelist = (seed.whitelist ?? []).map((e) => ({ ...e }));
  }

  list(kind: FraudListName): FraudListEntry[] {
    return this.byList[kind].map((e) => ({ ...e }));
  }

  add(kind: FraudListName, entry: FraudListEntry): FraudListEntry {
    this.byList[kind].push({ ...entry });
    return { ...entry };
  }

  remove(id: string): boolean {
    for (const kind of ["blacklist", "whitelist"] as const) {
      const before = this.byList[kind].length;
      this.byList[kind] = this.byList[kind].filter((e) => e.id !== id);
      if (this.byList[kind].length < before) return true;
    }
    return false;
  }

  snapshot(): FraudLists {
    return { blacklist: this.list("blacklist"), whitelist: this.list("whitelist") };
  }
}

/** Shared demo store used by the fraud-rules API routes. */
export const demoFraudListStore: FraudListStore = new InMemoryFraudListStore();

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

export function findBlacklistHit(
  lists: FraudLists,
  input: { phone: string; district: string },
): FraudListEntry | undefined {
  return lists.blacklist.find(
    (e) => matchesPhoneEntry(e, input.phone) || matchesAddressEntry(e, input.district),
  );
}

export function isWhitelisted(
  lists: FraudLists,
  input: { phone: string; district: string },
): boolean {
  return lists.whitelist.some(
    (e) => matchesPhoneEntry(e, input.phone) || matchesAddressEntry(e, input.district),
  );
}
