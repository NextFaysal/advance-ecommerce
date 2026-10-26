/**
 * Subscription-box generation — the box branch of the wave-51
 * sweep (ADV-23 vertical 4, wave 56). This module is called from
 * src/subscriptions/generate.ts INSIDE processDueSubscriptions;
 * there is deliberately no second sweep, no second idempotency
 * scheme and no second order path.
 *
 * ORDER SHAPE (the design decision, stated once): a generated box
 * order carries ONE line — the box variant itself at its catalog
 * price snapshot, quantity = the subscription's quantity — exactly
 * the line a wave-51 per-product subscription on the same variant
 * would create, priced through createManualOrder's single discount
 * stage. Totals are therefore byte-identical to the engine's own
 * arithmetic. The cycle CONTENTS are fulfilment detail, frozen
 * into the order's note (see buildBoxNoteText) and recorded in the
 * contents doc — NOT zero-price order lines: extra lines would add
 * per-line stock gates (one sold-out content item would fail the
 * whole box order), reserve stock for items that were never sold
 * as lines, and litter invoices/reports/returns with 0-poisha
 * rows. The warehouse picks from the note; the customer bought
 * "the box", and the box is the line.
 *
 * MISSING CONTENTS = SKIP, NEVER SUBSTITUTE: when the due cycle
 * has no contents defined, resolveBoxCycle returns "missing" and
 * the sweep records BOX_CONTENTS_MISSING on the row and advances
 * past the cycle (the engine's missed-cycle policy). An empty box
 * is never generated and the previous cycle's contents are never
 * silently re-shipped.
 */
import { qtyToString } from "@/lib/quantity";
import { isBoxVariantId, loadBoxesConfig, effectiveBoxDiscountBps, type BoxesConfig } from "./config";
import { findCycleContents, loadBoxContents, type BoxContentsDoc, type BoxCycleContents } from "./contents";
import { cycleKeyForInterval } from "./cycles";
import { subscriptionBoxesEnabled } from "./flags";

export interface BoxSweepContext {
  config: BoxesConfig;
  /** The discount box orders carry (box discount, or the global
   *  subscription discount when the box discount is 0). */
  discountBps: number;
  /** Per-variant contents-doc cache for one sweep run. */
  contentsCache: Map<string, BoxContentsDoc | null>;
}

/** Build the sweep's box context — null when the box layer is OFF
 *  (the sweep then treats every row as a plain wave-51 row). The
 *  engine flag itself is checked by the caller: this function is
 *  only reached from inside processDueSubscriptions, which already
 *  returned early when module.subscriptions is OFF. */
export async function createBoxSweepContext(
  globalDiscountBps: number,
): Promise<BoxSweepContext | null> {
  if (!subscriptionBoxesEnabled()) return null;
  const loaded = await loadBoxesConfig();
  return {
    config: loaded.config,
    discountBps: effectiveBoxDiscountBps(loaded.config, globalDiscountBps),
    contentsCache: new Map(),
  };
}

export function isBoxSubscription(ctx: BoxSweepContext, variantId: string): boolean {
  return isBoxVariantId(ctx.config, variantId);
}

export type BoxCycleResolution =
  | { kind: "missing"; cycleKey: string }
  | {
      kind: "ready";
      cycleKey: string;
      cycle: BoxCycleContents;
      discountBps: number;
      /** Extra order-note text (marker + frozen contents list). */
      noteText: string;
    };

/** Resolve the due cycle for one box subscription. `scheduledAt` is
 *  the row's SCHEDULED nextRunAt (not the sweep's `now`) — the same
 *  instant the deterministic idempotency key is built from, so a
 *  replayed sweep resolves the identical cycle. */
export async function resolveBoxCycle(
  ctx: BoxSweepContext,
  input: { variantId: string; interval: string; scheduledAt: Date },
): Promise<BoxCycleResolution> {
  const cycleKey = cycleKeyForInterval(input.interval, input.scheduledAt);
  if (!ctx.contentsCache.has(input.variantId)) {
    ctx.contentsCache.set(input.variantId, await loadBoxContents(input.variantId));
  }
  const cycle = findCycleContents(ctx.contentsCache.get(input.variantId) ?? null, cycleKey);
  if (cycle === null || cycle.items.length === 0) {
    return { kind: "missing", cycleKey };
  }
  return {
    kind: "ready",
    cycleKey,
    cycle,
    discountBps: ctx.discountBps,
    noteText: buildBoxNoteText(cycle),
  };
}

/** internalNote budget: createManualOrder caps the field at 500
 *  chars and the wave-51 subscription line already uses ~100, so
 *  the box segment stays within 380. Full form first (names + SKU);
 *  if a rich box overflows, the compact SKU form (SKUs are the
 *  warehouse's exact picking key); the `[box:<cycleKey>]` marker —
 *  the part other surfaces parse back — is in the header and is
 *  never truncated away. The untruncated contents always remain in
 *  the contents doc. */
const BOX_NOTE_BUDGET = 380;

export function buildBoxNoteText(cycle: BoxCycleContents): string {
  const theme = cycle.noteBn ? ` — ${cycle.noteBn.slice(0, 60)}` : "";
  const header = `সাবস্ক্রিপশন বক্স${theme} — সাইকেল ${cycle.cycleKey} [box:${cycle.cycleKey}]`;
  const full = `${header}\nপ্রতি বাক্সে: ${cycle.items
    .map((i) => `${i.productName} (${i.sku}) × ${qtyToString(i.quantity)}`)
    .join("; ")}`;
  if (full.length <= BOX_NOTE_BUDGET) return full;
  const compact = `${header}\nপ্রতি বাক্সে: ${cycle.items
    .map((i) => `${i.sku} × ${qtyToString(i.quantity)}`)
    .join("; ")}`;
  if (compact.length <= BOX_NOTE_BUDGET) return compact;
  return compact.slice(0, BOX_NOTE_BUDGET - 1) + "…";
}

/** The lastError recorded when a box cycle is skipped. Bilingual
 *  like every customer/staff-facing string in the engine, and
 *  prefixed with a stable code so the admin list can group them. */
export function boxContentsMissingError(cycleKey: string): string {
  return (
    `BOX_CONTENTS_MISSING: ${cycleKey} সাইকেলের বাক্সের তালিকা নির্ধারণ করা হয়নি — ` +
    `এই চক্রে অর্ডার তৈরি হয়নি। / No contents defined for cycle ${cycleKey}; ` +
    `this cycle was skipped, no order was created.`
  ).slice(0, 500);
}
