/**
 * Reversal hooks — the mirror image of delivered-hooks.ts (plan doc 17,
 * batch O0). Delivered hooks credit loyalty points, the reseller wallet
 * and vendor commission lines exactly once when an order lands in
 * DELIVERED; NOTHING used to claw those credits back, so a returned or
 * refunded order kept them all — and reseller credits are withdrawable,
 * which made a return a potential cash leak. This module is the single
 * place that reverses them.
 *
 * Call sites (the same two funnels that persist Order.status — kept in
 * lockstep with the delivered-hooks wiring in src/orders/repository.ts):
 *  - applyOrderTransition() — after its transaction commits, when the
 *    state machine moved the order INTO CANCELLED / RETURNED / REFUNDED.
 *  - saveOrder() — when a bulk-actions save moved the stored status
 *    INTO one of those states.
 *
 * SEMANTICS PER TARGET STATE:
 *  - CANCELLED: the order's CouponUsage row is deleted. usedCount and
 *    the per-user counts are DERIVED from CouponUsage rows (see
 *    src/marketing/repository.ts), so deleting the row restores both
 *    the global limit and the customer's per-user slot. A gift-card
 *    redemption on the order is likewise restored (REFUND_RESTORE,
 *    ADV-18 — see the gift-card section below). (Bundle stock
 *    release on cancel lives in product-types and is NOT duplicated
 *    here.) Credits are not touched on cancel: the state machine only
 *    allows cancelling from pre-delivery states, where the delivered
 *    hooks never ran.
 *  - RETURNED / REFUNDED: every credit the delivered hooks wrote for
 *    this order is reversed exactly once (details per section below).
 *    Detection is the credits themselves — the same persisted markers
 *    the delivered hooks key on. If no credit rows exist for the order,
 *    the delivered hooks never ran (or wrote nothing) and every section
 *    is a no-op.
 *  - REFUNDED additionally restores the coupon, but ONLY on a FULL
 *    refund of an order that had been DELIVERED: the Refund sum for
 *    the order (all rows, the markOrderPayment funnel's own math) must
 *    cover the order total. A partial refund keeps the coupon consumed
 *    — the customer kept part of the discount's value.
 *
 * EXACTLY-ONCE: every reversal is keyed to its original credit row and
 * checks for its own marker before writing, so re-running this hook
 * (or a second RETURNED/REFUNDED transition attempt) is a strict no-op:
 *  - Loyalty: reversal entry id is `<original entry id>_reversal`.
 *  - Reseller: kind "REVERSAL" wallet rows with refId = orderId; the
 *    section writes all of an order's debits in ONE transaction, so
 *    "any REVERSAL row for this order" is a sound section marker.
 *  - Vendor: a VendorRefund chargeback whose reason carries
 *    VENDOR_REVERSAL_REASON_PREFIX, one per commission line.
 *  - Coupon: deleting an absent row is naturally a no-op.
 *
 * NEVER-THROW RULE (same contract as delivered-hooks): a reversal
 * failure must never fail the transition itself. Every section is
 * isolated in its own try/catch and logs server-side.
 */
import { prisma } from "@advance-ecommerce/db";
import { availableBalance } from "../loyalty/points";
import { refreshCouponSnapshot } from "../marketing/repository";
import { vendorStore } from "../vendors/db-store";

/** Wallet kind for reversal debits. The reseller wallet's TS kind union
 *  has no REVERSAL member (it predates this engine); the schema column
 *  is a free String and rowToWalletEntry passes kinds through verbatim,
 *  so the value is stored and read back as-is. A dedicated kind (rather
 *  than ADJUSTMENT) keeps the exactly-once probe precise: a manual
 *  adjustment can never be mistaken for a reversal or vice versa. */
const RESELLER_REVERSAL_KIND = "REVERSAL";

/** Marker prefix on the VendorRefund rows this engine writes, so a
 *  replay finds its own chargeback instead of writing a second one.
 *  VendorRefund has no idempotency key column; (vendorId, orderId,
 *  reason prefix) is the durable marker. */
const VENDOR_REVERSAL_REASON_PREFIX = "Commission reversal (order returned/refunded):";

function logReversalError(section: string, orderId: string, err: unknown): void {
  console.error(`[reversal-hooks] ${section} failed for order ${orderId}:`, err);
}

/* ------------------------------------------------------------------ */
/* Coupon                                                              */
/* ------------------------------------------------------------------ */

/** Delete the order's CouponUsage row (at most one exists — the schema
 *  is @@unique([couponId, orderId])) and refresh the checkout coupon
 *  snapshot so the restored usage counts are evaluable immediately. */
async function restoreCouponUsage(orderId: string): Promise<void> {
  const deleted = await prisma.couponUsage.deleteMany({ where: { orderId } });
  if (deleted.count > 0) {
    await refreshCouponSnapshot();
  }
}

/** Coupon restore for the REFUNDED path: full refund only, and only
 *  when the order had actually been DELIVERED (a refund of a
 *  never-delivered prepaid order is the workbench's concern, and the
 *  coupon semantics there follow the cancel rule instead). "Full" uses
 *  the Refund sum over money-moved rows (SENT/CONFIRMED/COMPLETED) —
 *  the same aggregate markOrderPayment derives paymentStatus from, so
 *  the two can never disagree about what "refunded in full" means. */
async function restoreCouponOnFullRefund(order: { id: string; totalPoisha: number }): Promise<void> {
  if (order.totalPoisha <= 0) return;
  const delivered = await prisma.orderStatusHistory.findFirst({
    where: { orderId: order.id, to: "DELIVERED" },
    select: { id: true },
  });
  if (!delivered) return;
  const agg = await prisma.refund.aggregate({
    where: { orderId: order.id, status: { in: ["SENT", "CONFIRMED", "COMPLETED"] } },
    _sum: { amountPoisha: true },
  });
  if ((agg._sum.amountPoisha ?? 0) >= order.totalPoisha) {
    await restoreCouponUsage(order.id);
  }
}

/* ------------------------------------------------------------------ */
/* Gift card (ADV-18)                                                  */
/* ------------------------------------------------------------------ */

/**
 * Restore the order's gift-card redemption on cancel: the REDEEM row
 * the create transaction wrote gets its REFUND_RESTORE mirror
 * (+redeemed amount) from src/marketing/gift-cards, exactly once
 * (the service keys on its own marker row). Cancel-only by design in
 * this slice: a pre-delivery cancel means the stored value was never
 * really spent, while a RETURNED/REFUNDED order's gift-card value is
 * a staff refund decision in the refund workbench (see the ADV-18
 * report). Dynamic import, same cycle discipline as loyalty below.
 */
async function restoreGiftCard(orderId: string): Promise<void> {
  const giftCards = await import("../marketing/gift-cards");
  await giftCards.restoreGiftCardForCancelledOrder(orderId);
}

/* ------------------------------------------------------------------ */
/* Loyalty                                                             */
/* ------------------------------------------------------------------ */

/**
 * Reverse every EARN ledger entry the delivered hooks wrote for this
 * order — the order earn (id pts_earn_<orderId>) and any referral
 * rewards (ids pts_ref_<referralId>_referrer / _referee, which carry
 * this order's id as their orderId) — with one ADJUST entry per
 * original, id `<original id>_reversal`, so a replay finds the marker
 * and skips.
 *
 * Shortfall rule (never throws, never invents points): the reversal
 * debits at most the customer's CURRENT available balance (the FIFO
 * fold in loyalty/points, unexpired lots only). Points already spent
 * or expired cannot be clawed back out of thin air; the undebited
 * remainder is recorded as the shortfall in the entry's reason — the
 * ledger's only free-text field — so the gap is auditable, never
 * silent. A fully-spent earn still gets its (zero-point) reversal
 * entry: the entry IS the durable record that the credit was addressed.
 *
 * The Referral row itself is deliberately left REWARDED: the clawback
 * lives in the ledger, and flipping the referral back to PENDING would
 * let a later re-delivery pay the reward a second time.
 */
async function reverseLoyalty(order: { id: string }): Promise<void> {
  // Dynamic import: src/loyalty/db-store.ts imports getOrderByIdOrNo
  // from src/orders/repository.ts, and repository.ts imports the hook
  // entry point below — a static import here would close that cycle
  // (same reason delivered-hooks loads loyalty dynamically).
  const loyalty = await import("../loyalty/db-store");
  const earnRows = await prisma.pointsLedgerEntry.findMany({
    where: { orderId: order.id, kind: "EARN", points: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });
  if (earnRows.length === 0) return;
  const byCustomer = new Map<string, typeof earnRows>();
  for (const row of earnRows) {
    const list = byCustomer.get(row.customerId) ?? [];
    list.push(row);
    byCustomer.set(row.customerId, list);
  }
  const nowIso = new Date().toISOString();
  for (const [customerId, rows] of byCustomer) {
    let entries = await loyalty.loyaltyStore.listEntries(customerId);
    for (const orig of rows) {
      const reversalId = `${orig.id}_reversal`;
      if (entries.some((e) => e.id === reversalId)) continue;
      const available = Math.max(0, availableBalance(entries, nowIso));
      const debit = Math.min(orig.points, available);
      const shortfall = orig.points - debit;
      const saved = await loyalty.loyaltyStore.appendEntry({
        id: reversalId,
        customerId,
        type: "ADJUST",
        points: -debit,
        orderId: order.id,
        reason:
          `REVERSAL of ${orig.id}: earned ${orig.points} pts on a delivered order that was returned/refunded; ` +
          `debited ${debit} pts` +
          (shortfall > 0 ? `; shortfall ${shortfall} pts already spent or expired before reversal` : ""),
        expiresAt: null,
        createdAt: nowIso,
      });
      entries = [...entries, saved];
    }
  }
}

/* ------------------------------------------------------------------ */
/* Reseller wallet                                                     */
/* ------------------------------------------------------------------ */

/**
 * Debit back every wallet credit the delivered hooks wrote for this
 * order (COMMISSION_CREDIT + MARGIN_CREDIT rows with refId = orderId),
 * one REVERSAL row per original credit, amount = −credit, written in
 * one transaction with balanceAfterPoisha recomputed along the way.
 *
 * DELIBERATE RULE BREAK: the pure wallet logic (reseller/wallet.ts)
 * refuses any entry that would take the balance negative, because no
 * SPEND may exceed the balance. A reversal is not a spend — the money
 * was credited for a sale that has now un-happened. Per plan O0 the
 * debit ALWAYS lands, even when the reseller has already withdrawn the
 * money: the wallet goes negative and the negative balance is the
 * recorded debt, visible in every balance read (balances are the sum
 * of entries). Skipping the debit silently would keep the cash leak
 * this engine exists to close. That is why this section writes rows
 * directly instead of going through creditDeliveredOrder's pure-logic
 * counterpart.
 *
 * Lifetime-sales / tier derivation reads CREDIT kinds only, so a
 * reversal does not rewrite the reseller's tier history.
 */
async function reverseReseller(orderId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const credits = await tx.resellerWalletEntry.findMany({
      where: { refId: orderId, kind: { in: ["COMMISSION_CREDIT", "MARGIN_CREDIT"] } },
      orderBy: { createdAt: "asc" },
    });
    if (credits.length === 0) return;
    const already = await tx.resellerWalletEntry.findFirst({
      where: { refId: orderId, kind: RESELLER_REVERSAL_KIND },
      select: { id: true },
    });
    if (already) return;
    const resellerIds = [...new Set(credits.map((c) => c.resellerId))];
    for (const resellerId of resellerIds) {
      const all = await tx.resellerWalletEntry.findMany({
        where: { resellerId },
        orderBy: { createdAt: "asc" },
      });
      let balance = all.reduce((sum, e) => sum + e.amountPoisha, 0);
      for (const credit of credits.filter((c) => c.resellerId === resellerId)) {
        balance -= credit.amountPoisha;
        await tx.resellerWalletEntry.create({
          data: {
            resellerId,
            kind: RESELLER_REVERSAL_KIND,
            amountPoisha: -credit.amountPoisha,
            balanceAfterPoisha: balance,
            refId: orderId,
          },
        });
      }
    }
  });
}

/* ------------------------------------------------------------------ */
/* Vendor commission                                                   */
/* ------------------------------------------------------------------ */

/**
 * Reverse the order's vendor commission lines. The lines were written
 * as VendorCommissionLine rows (one per (order, vendor), unique); the
 * codebase's existing mirror-image write is the VendorRefund chargeback
 * — payout summaries (vendors/service summarizePayout) subtract the
 * SUM of a vendor's VendorRefund rows from gross − commission, so a
 * chargeback of exactly the line's vendorEarningPoisha zeroes the
 * line's payout effect while keeping the delivered credit on the
 * record. The commission line itself is NOT deleted: the ledger stays
 * append-only and auditable.
 *
 * Not flag-gated: lines can only exist if the delivered hook wrote
 * them (flag was on at delivery). Turning the module off later must
 * not strand a live credit un-reversed.
 */
async function reverseVendors(orderId: string): Promise<void> {
  const lines = await prisma.vendorCommissionLine.findMany({ where: { orderId } });
  for (const line of lines) {
    if (line.vendorEarningPoisha <= 0) continue;
    const already = await prisma.vendorRefund.findFirst({
      where: {
        vendorId: line.vendorId,
        orderId,
        reason: { startsWith: VENDOR_REVERSAL_REASON_PREFIX },
      },
      select: { id: true },
    });
    if (already) continue;
    await vendorStore.addRefund({
      vendorId: line.vendorId,
      orderId,
      amountPoisha: line.vendorEarningPoisha,
      reason:
        `${VENDOR_REVERSAL_REASON_PREFIX} reverses the delivered-order commission line ` +
        `(gross ${line.grossPoisha} poisha, platform commission ${line.commissionPoisha} poisha, ` +
        `vendor earning ${line.vendorEarningPoisha} poisha).`,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/**
 * Run every reversal for an order that has JUST been persisted as
 * CANCELLED, RETURNED or REFUNDED. Loads the order row itself so call
 * sites stay one line, exactly like runDeliveredOrderHooks. Never
 * throws.
 */
export async function runReversalHooks(orderId: string): Promise<void> {
  try {
    const row = await prisma.order.findFirst({
      where: { id: orderId, deletedAt: null },
      select: { id: true, status: true, totalPoisha: true },
    });
    if (!row) return;
    if (row.status === "CANCELLED") {
      try {
        await restoreCouponUsage(row.id);
      } catch (err) {
        logReversalError("coupon", row.id, err);
      }
      try {
        await restoreGiftCard(row.id);
      } catch (err) {
        logReversalError("gift-card", row.id, err);
      }
      return;
    }
    if (row.status !== "RETURNED" && row.status !== "REFUNDED") return;
    try {
      await reverseLoyalty(row);
    } catch (err) {
      logReversalError("loyalty", row.id, err);
    }
    try {
      await reverseReseller(row.id);
    } catch (err) {
      logReversalError("reseller", row.id, err);
    }
    try {
      await reverseVendors(row.id);
    } catch (err) {
      logReversalError("vendors", row.id, err);
    }
    if (row.status === "REFUNDED") {
      try {
        await restoreCouponOnFullRefund(row);
      } catch (err) {
        logReversalError("coupon-refund", row.id, err);
      }
    }
  } catch (err) {
    logReversalError("load", orderId, err);
  }
}
