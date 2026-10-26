/**
 * ERP auto-posting — ADV-11 (doc 22). Journal entries created
 * automatically from real money events, behind the module.erp_lite
 * flag:
 *
 *   order PAID (the markOrderPayment transition INTO PAID — the same
 *     exactly-once seam the event-bus publish, digital fulfilment and
 *     the automation producer use):
 *       money arrived directly (gateway / manual / cash):
 *         Dr payment-asset (by method)          = order total
 *         Cr 4000 Sales revenue                 = total − VAT − delivery
 *         Cr 4100 Delivery income               = shippingPoisha
 *         Cr 2100 VAT payable                   = recorded Order.vatPoisha
 *       courier COD collection (the order carries the courier-cod
 *       OrderNote marker — the courier holds the cash, so the debit
 *       is a receivable, NOT cash):
 *         Dr 1100 Accounts receivable (courier) = order total, Cr same
 *         split. The later remittance settlement (Dr Cash / Cr 1100)
 *         is the wave-26 remittance batch's close — NOT posted here.
 *   refund CONFIRMED (refund workbench terminal state):
 *         Dr 4000 Sales (contra) + Dr 2100 VAT (pro-rata share of the
 *         order's recorded VAT) / Cr payout asset (by payout channel).
 *   purchase received: Dr 1200 Inventory / Cr 2000 Accounts payable —
 *     SERVICE ONLY, NO LIVE CALLER: the audit for this wave found no
 *     purchase-receive funnel anywhere in the codebase (nothing ever
 *     writes PurchaseOrderItem.quantityReceived / receivedAt / status
 *     RECEIVED), so there is no event to hook. The function posts the
 *     CURRENT recorded received value if one ever appears.
 *
 * EXACTLY-ONCE (updated schema wave 2, 2026-10-26): ErpJournalEntry
 * now carries @@unique([sourceKind, sourceId]) — dedupe is DB-enforced
 * for non-null pairs. appendOnce still does its findFirst first (a
 * friendly already_posted answer instead of a unique-violation), but
 * two CONCURRENT duplicate transitions can no longer both append:
 * the loser gets a unique violation, which the never-throw wrappers
 * below return as { status: "skipped" }. Migration audit trail: the
 * local DB held 0 journal entries (0 duplicate pairs) when the
 * constraint was added; PRODUCTION (Neon) was NOT audited from here —
 * if it ever held duplicate pairs the migration's CREATE UNIQUE
 * INDEX would fail loudly at deploy rather than silently dedupe.
 *
 * VAT: only the RECORDED split (Order.vatPoisha, written at create
 * time when accounting.vat_rate_bps was configured) is posted. When
 * it is null the full non-delivery amount posts to Sales — the split
 * is never reconstructed after the fact (the db-store convention).
 *
 * Every function NEVER throws: failures return { status: "skipped" }
 * so a posting problem can never break the money funnel that called
 * it (the delivered-hooks / automation-producer discipline).
 */
import { prisma } from "@advance-ecommerce/db";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { erpStore } from "./db-store";
import { PeriodLockedError, buildJournalEntry, postEntry } from "./ledger";
import type { JournalLine } from "./types";

export const ERP_AUTO_POST_FLAG = "module.erp_lite";

export type AutoPostResult =
  | { status: "posted"; entryId: string }
  | { status: "already_posted"; entryId: string }
  | { status: "skipped"; reason: string };

/** "YYYY-MM-DD" on the Asia/Dhaka calendar (db-store pattern). */
function dhakaToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Asset account that received money, by order payment method. */
function assetAccountForMethod(method: string): string {
  switch (method) {
    case "BKASH":
      return "1020"; // bKash merchant wallet
    case "NAGAD":
      return "1030"; // Nagad merchant wallet
    case "COD":
      return "1000"; // Cash in hand (own-channel collection)
    default:
      return "1010"; // Bank account (cards / gateways / manual bank)
  }
}

/** Asset account a refund was paid out from, by workbench channel. */
function assetAccountForRefund(refund: { payoutMethod: string | null; method: string }): string {
  switch ((refund.payoutMethod ?? "").toLowerCase()) {
    case "bkash":
      return "1020";
    case "nagad":
      return "1030";
    case "bank":
    case "gateway":
      return "1010";
    case "cash":
      return "1000";
    case "other":
      return "1000";
    default:
      return assetAccountForMethod(refund.method);
  }
}

/**
 * Revenue credit split shared by the direct-paid and courier-COD
 * variants. Guaranteed to sum to totalPoisha with no negative or
 * zero lines (the ledger rejects both).
 */
function revenueCreditLines(input: {
  totalPoisha: number;
  shippingPoisha: number;
  vatPoisha: number | null;
}): JournalLine[] {
  const vat = input.vatPoisha ?? 0;
  let delivery = input.shippingPoisha;
  let sales = input.totalPoisha - vat - delivery;
  if (sales < 0) {
    // Degenerate split (delivery alone exceeds the net): fold the
    // delivery income into Sales so no line goes negative.
    sales = input.totalPoisha - vat;
    delivery = 0;
  }
  const lines: JournalLine[] = [];
  if (sales > 0) lines.push({ accountCode: "4000", debitPoisha: 0, creditPoisha: sales });
  if (delivery > 0) lines.push({ accountCode: "4100", debitPoisha: 0, creditPoisha: delivery });
  if (vat > 0) lines.push({ accountCode: "2100", debitPoisha: 0, creditPoisha: vat });
  return lines;
}

async function appendOnce(input: {
  sourceKind: string;
  sourceId: string;
  description: string;
  lines: JournalLine[];
}): Promise<AutoPostResult> {
  const existing = await prisma.erpJournalEntry.findFirst({
    where: { sourceKind: input.sourceKind, sourceId: input.sourceId },
    select: { id: true },
  });
  if (existing) return { status: "already_posted", entryId: existing.id };
  const periods = await erpStore.listPeriods();
  const posted = postEntry(
    buildJournalEntry(
      {
        date: dhakaToday(),
        description: input.description,
        lines: input.lines,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
      },
      new Date(),
    ),
    periods,
  );
  const stored = await erpStore.appendEntry(posted);
  return { status: "posted", entryId: stored.id };
}

function skipped(reason: string): AutoPostResult {
  return { status: "skipped", reason };
}

/* ------------------------------------------------------------------ */
/* Order PAID                                                          */
/* ------------------------------------------------------------------ */

export async function postOrderPaidErp(orderId: string): Promise<AutoPostResult> {
  try {
    if (!isFeatureEnabled(ERP_AUTO_POST_FLAG)) return skipped("flag_off");
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        totalPoisha: true,
        shippingPoisha: true,
        vatPoisha: true,
        paymentMethod: true,
      },
    });
    if (!order) return skipped("order_not_found");
    if (order.totalPoisha <= 0) return skipped("zero_total");

    // Courier COD? The courier sync records its collection with the
    // `courier-cod:<provider>:<eventId>` OrderNote marker (the only
    // provider-attribution evidence — see orders/remittance).
    const marker = await prisma.orderNote.findFirst({
      where: { orderId, text: { startsWith: "courier-cod:" } },
      select: { text: true },
    });
    const credits = revenueCreditLines(order);
    if (marker) {
      const provider = marker.text.split(":")[1] ?? "courier";
      return await appendOnce({
        sourceKind: "order_paid",
        sourceId: orderId,
        description: `Auto-posting: order ${order.orderNo} — COD collected by courier (${provider}); cash held by courier`,
        lines: [
          { accountCode: "1100", debitPoisha: order.totalPoisha, creditPoisha: 0 },
          ...credits,
        ],
      });
    }
    return await appendOnce({
      sourceKind: "order_paid",
      sourceId: orderId,
      description: `Auto-posting: order ${order.orderNo} paid (${order.paymentMethod}) — sales + delivery + VAT`,
      lines: [
        { accountCode: assetAccountForMethod(order.paymentMethod), debitPoisha: order.totalPoisha, creditPoisha: 0 },
        ...credits,
      ],
    });
  } catch (err) {
    if (err instanceof PeriodLockedError) return skipped("period_locked");
    return skipped(err instanceof Error ? err.message : "unknown_error");
  }
}

/* ------------------------------------------------------------------ */
/* Refund CONFIRMED                                                    */
/* ------------------------------------------------------------------ */

export async function postRefundConfirmedErp(refundId: string): Promise<AutoPostResult> {
  try {
    if (!isFeatureEnabled(ERP_AUTO_POST_FLAG)) return skipped("flag_off");
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      select: {
        id: true,
        orderId: true,
        amountPoisha: true,
        method: true,
        payoutMethod: true,
        status: true,
      },
    });
    if (!refund) return skipped("refund_not_found");
    if (refund.status !== "CONFIRMED") return skipped("refund_not_confirmed");
    if (refund.amountPoisha <= 0) return skipped("zero_amount");
    const order = await prisma.order.findUnique({
      where: { id: refund.orderId },
      select: { orderNo: true, totalPoisha: true, vatPoisha: true },
    });
    if (!order) return skipped("order_not_found");

    // The refund's VAT share is pro-rata against the order's RECORDED
    // VAT (never a reconstructed rate): refund × vat ÷ total.
    const vatShare =
      order.vatPoisha && order.totalPoisha > 0
        ? Math.round((refund.amountPoisha * order.vatPoisha) / order.totalPoisha)
        : 0;
    const salesShare = refund.amountPoisha - vatShare;
    const lines: JournalLine[] = [];
    if (salesShare > 0) lines.push({ accountCode: "4000", debitPoisha: salesShare, creditPoisha: 0 });
    if (vatShare > 0) lines.push({ accountCode: "2100", debitPoisha: vatShare, creditPoisha: 0 });
    lines.push({
      accountCode: assetAccountForRefund(refund),
      debitPoisha: 0,
      creditPoisha: refund.amountPoisha,
    });
    return await appendOnce({
      sourceKind: "refund_confirmed",
      sourceId: refundId,
      description: `Auto-posting: refund confirmed for order ${order.orderNo} — sales/VAT reversal`,
      lines,
    });
  } catch (err) {
    if (err instanceof PeriodLockedError) return skipped("period_locked");
    return skipped(err instanceof Error ? err.message : "unknown_error");
  }
}

/* ------------------------------------------------------------------ */
/* Purchase received (service only — no live receive funnel exists)    */
/* ------------------------------------------------------------------ */

export async function postPurchaseReceivedErp(purchaseOrderId: string): Promise<AutoPostResult> {
  try {
    if (!isFeatureEnabled(ERP_AUTO_POST_FLAG)) return skipped("flag_off");
    const po = await prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: {
        items: { select: { quantityReceived: true, costPoisha: true } },
        supplier: { select: { name: true } },
      },
    });
    if (!po) return skipped("purchase_order_not_found");
    const receivedPoisha = po.items.reduce((s, i) => s + i.quantityReceived * i.costPoisha, 0);
    if (receivedPoisha <= 0) return skipped("nothing_received_recorded");
    return await appendOnce({
      sourceKind: "purchase_received",
      sourceId: purchaseOrderId,
      description: `Auto-posting: purchase received from ${po.supplier.name} — inventory / payable`,
      lines: [
        { accountCode: "1200", debitPoisha: receivedPoisha, creditPoisha: 0 },
        { accountCode: "2000", debitPoisha: 0, creditPoisha: receivedPoisha },
      ],
    });
  } catch (err) {
    if (err instanceof PeriodLockedError) return skipped("period_locked");
    return skipped(err instanceof Error ? err.message : "unknown_error");
  }
}
