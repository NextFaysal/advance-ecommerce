// Idempotency — one checkout attempt, one order, even on double-submit / retry.
// Client generates ONE uuid per attempt and reuses it on retry; the server
// enforces the UNIQUE constraint on Order.idempotencyKey and returns the
// original order on a duplicate key instead of creating a second order.
// The in-memory store below is a process-local fast-path guard on top of
// that DB constraint: it catches double-submits inside one process before
// they reach the database. It is NOT the guarantee — the DB key is.
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

/** In-memory claim store — the fast-path half of the two-layer guard. */
export class InMemoryIdempotencyStore {
  private claimed = new Set<string>();

  /** Returns true on first claim, false if this key was already used. */
  claim(key: string): boolean {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }

  /**
   * Releases a claim after a FAILED attempt (wave 20, plan 17 O2).
   * Before this, every failure — variant missing, insufficient stock,
   * fraud block — poisoned the key for the life of the process, so a
   * corrected retry with the same key got a 409 instead of its order.
   * Callers release ONLY when no order was persisted for the key; a
   * successful create keeps its claim, and a later retry is answered
   * by the DB replay lookup (or the UNIQUE constraint race guard), so
   * releasing on failure can never produce a duplicate order.
   */
  release(key: string): void {
    this.claimed.delete(key);
  }
}
