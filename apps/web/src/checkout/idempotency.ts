// Idempotency — one checkout attempt, one order, even on double-submit / retry.
// Client generates ONE uuid per attempt and reuses it on retry; the server must
// enforce a UNIQUE constraint on (idempotency_key) in the orders table and
// return the original order on a duplicate key instead of creating a second order.
// The in-memory store below is TEMPORARY (demo / unit-test use only). It is NOT
// a substitute for the DB constraint, which is listed in orders/SCHEMA-ADDITIONS.md.
import { z } from "zod";

export const idempotencyKeySchema = z.string().uuid();

export function newIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback only for very old runtimes; prefer crypto.randomUUID.
  return `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

export function isValidIdempotencyKey(key: string): boolean {
  return idempotencyKeySchema.safeParse(key).success;
}

/** TEMPORARY in-memory claim store — replace with DB unique key in production. */
export class InMemoryIdempotencyStore {
  private claimed = new Set<string>();

  /** Returns true on first claim, false if this key was already used. */
  claim(key: string): boolean {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
}
