/**
 * POS offline -> online sync — flush the localStorage queue
 * (offline-queue.ts) to the POS sale API.
 *
 * Retry safety comes from the sale's idempotencyKey end-to-end: the
 * key is generated once when the sale is completed, stored in the
 * queue, sent on every attempt, and the server dedupes on it
 * (createSaleDb returns the FIRST record with duplicate: true — the
 * schema's @unique on PosSale.idempotencyKey is the backstop). So a
 * flush whose response was lost (network died mid-request) can be
 * retried any number of times: the sale is recorded exactly once, and
 * a duplicate response counts as SYNCED here — the server provably
 * has the record.
 *
 * A sale is removed from the queue ONLY on a confirmed response
 * (fresh or duplicate). Any failure — offline, 4xx, 5xx — leaves it
 * queued and is reported per-sale; the register UI surfaces the count
 * and the first error, and closing a shift is blocked while its sales
 * are still queued (the server counts expected cash from ITS records).
 *
 * The transport is injectable so the flush logic is smoke-testable
 * without a network; the browser default posts with fetch.
 */
import { loadQueuedPosSales, removeQueuedPosSale } from "./offline-queue";
import type { CreatePosSaleInput, PosSale } from "./types";

export type PosSaleTransportResult =
  | { ok: true; sale: PosSale; duplicate: boolean }
  | { ok: false; status?: number; message: string };

export type PosSaleTransport = (input: CreatePosSaleInput) => Promise<PosSaleTransportResult>;

/** Browser transport: POST /api/v1/admin/pos/sale (admin session cookie). */
export const postPosSaleTransport: PosSaleTransport = async (input) => {
  let res: Response;
  try {
    res = await fetch("/api/v1/admin/pos/sale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, message: "Network unreachable — sale stays queued." };
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: { sale?: PosSale; duplicate?: boolean };
    error?: { message?: string };
  };
  if (!res.ok || !body.data?.sale) {
    return {
      ok: false,
      status: res.status,
      message: body.error?.message ?? `Sale sync failed (HTTP ${res.status}).`,
    };
  }
  return { ok: true, sale: body.data.sale, duplicate: body.data.duplicate ?? false };
};

export interface PosSyncReport {
  /** Sales the server confirmed during this flush (fresh or duplicate). */
  synced: { idempotencyKey: string; sale: PosSale; duplicate: boolean }[];
  /** Sales still queued after this flush, with the failure reason. */
  failed: { idempotencyKey: string; message: string }[];
  /** Queue length after the flush. */
  remaining: number;
}

/**
 * Flush every queued sale, oldest first. Sequential on purpose: a
 * till coming back online replays its sales in the order they were
 * rung up, and one failure never blocks the rest of the queue.
 */
export async function flushQueuedPosSales(
  transport: PosSaleTransport = postPosSaleTransport,
): Promise<PosSyncReport> {
  const report: PosSyncReport = { synced: [], failed: [], remaining: 0 };
  for (const entry of loadQueuedPosSales()) {
    const key = entry.input.idempotencyKey;
    let result: PosSaleTransportResult;
    try {
      result = await transport(entry.input);
    } catch (err) {
      result = {
        ok: false,
        message: err instanceof Error ? err.message : "Sale sync failed unexpectedly.",
      };
    }
    if (result.ok) {
      removeQueuedPosSale(key);
      report.synced.push({ idempotencyKey: key, sale: result.sale, duplicate: result.duplicate });
    } else {
      report.failed.push({ idempotencyKey: key, message: result.message });
    }
  }
  report.remaining = loadQueuedPosSales().length;
  return report;
}
