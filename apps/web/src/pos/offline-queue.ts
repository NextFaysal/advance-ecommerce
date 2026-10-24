/**
 * POS offline sale queue — browser localStorage, the durable half of
 * the offline-first register (types.ts header): while the network is
 * down, completed sales are recorded HERE with their client-generated
 * idempotency key, and src/pos/sync.ts flushes them to the POS sale
 * API when connectivity returns. A sale leaves the queue only after
 * the server confirms it has the record (a fresh 201 or an idempotent
 * duplicate response) — never on a timer, never silently.
 *
 * Browser-guarded exactly like src/cart/persistence.ts: every function
 * no-ops / returns [] during SSR. The queue survives page reloads and
 * browser restarts; it is per-browser (per till), which is the honest
 * scope of a counter register.
 */
import type { CreatePosSaleInput, PosSale } from "./types";

export const POS_SALE_QUEUE_KEY = "advance-ecommerce-pos-sale-queue";

export interface QueuedPosSale {
  /** The exact payload to POST on flush — idempotencyKey included. */
  input: CreatePosSaleInput;
  /** Locally built display copy (status QUEUED_OFFLINE, local id). */
  sale: PosSale;
}

function isQueuedPosSale(value: unknown): value is QueuedPosSale {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as { input?: unknown; sale?: unknown };
  if (typeof entry.input !== "object" || entry.input === null) return false;
  if (typeof entry.sale !== "object" || entry.sale === null) return false;
  const input = entry.input as { idempotencyKey?: unknown };
  const sale = entry.sale as { id?: unknown; idempotencyKey?: unknown };
  return (
    typeof input.idempotencyKey === "string" &&
    input.idempotencyKey.length > 0 &&
    typeof sale.id === "string" &&
    sale.idempotencyKey === input.idempotencyKey
  );
}

export function loadQueuedPosSales(): QueuedPosSale[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(POS_SALE_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Drop malformed entries rather than letting one bad record wedge
    // every future flush; well-formed entries are unaffected.
    return parsed.filter(isQueuedPosSale);
  } catch {
    return [];
  }
}

export function saveQueuedPosSales(queue: readonly QueuedPosSale[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POS_SALE_QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Storage full / private mode: the in-memory list in the register
    // component still holds the sales for this session, and the sync
    // panel keeps reporting them as pending — nothing claims synced.
  }
}

/**
 * Add a sale to the queue. Idempotent per idempotencyKey: queueing the
 * same key twice keeps the FIRST entry (a key identifies one sale
 * attempt; the register generates a fresh key per completed sale).
 * Returns the resulting queue.
 */
export function enqueuePosSale(entry: QueuedPosSale): QueuedPosSale[] {
  const queue = loadQueuedPosSales();
  if (queue.some((q) => q.input.idempotencyKey === entry.input.idempotencyKey)) {
    return queue;
  }
  const next = [...queue, entry];
  saveQueuedPosSales(next);
  return next;
}

/** Remove one queued sale after the server confirms the record. */
export function removeQueuedPosSale(idempotencyKey: string): QueuedPosSale[] {
  const next = loadQueuedPosSales().filter((q) => q.input.idempotencyKey !== idempotencyKey);
  saveQueuedPosSales(next);
  return next;
}

export function clearQueuedPosSales(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(POS_SALE_QUEUE_KEY);
  } catch {
    // Nothing to clear against — loadQueuedPosSales already guards.
  }
}
