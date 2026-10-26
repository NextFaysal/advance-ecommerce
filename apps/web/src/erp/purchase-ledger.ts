/**
 * Purchase ledger — ADV-11 (doc 22): supplier payables read model.
 *
 * Built ONLY over real records:
 *  - Ordered / received value: PurchaseOrder + PurchaseOrderItem rows
 *    (received = Σ quantityReceived × costPoisha). Received figures
 *    are written by the PO receive flow (ADV-11b,
 *    src/inventory/purchase-receive.ts); POs nobody has received
 *    against still read 0 — figures are shown as recorded, never
 *    estimated.
 *  - Payments: POSTED journal entries with sourceKind
 *    "supplier_payment" (written via the ERP journal — the typed
 *    builder in ledger.ts stores the amount as the Dr 2000 line and
 *    the purchase order id as sourceId). A payment is attributed to
 *    a supplier through its purchase order; payments whose sourceId
 *    names no known PO are reported in `unattributedPaymentsPoisha`
 *    instead of being guessed onto a supplier.
 *  - Outstanding = received − paid (a payable arises on RECEIPT, not
 *    on order placement). Ordered totals are shown for context only.
 *  - Aging buckets run over POs that carry an outstanding balance,
 *    aged from receivedAt when set, else the PO's creation date.
 *  - Purchase-side VAT: PurchaseOrderItem has NO VAT fields, so no
 *    input-VAT figure can be derived — `purchaseVatTracked` is false
 *    and the VAT report stays sales-only until the schema grows a
 *    purchase VAT split. Nothing here invents one.
 */
import { prisma } from "@advance-ecommerce/db";

export interface PurchaseLedgerPoRow {
  id: string;
  supplierId: string;
  supplierName: string;
  status: string;
  orderedPoisha: number;
  receivedPoisha: number;
  paidPoisha: number;
  outstandingPoisha: number;
  /** Dhaka "YYYY-MM-DD" the outstanding balance started ageing from. */
  agingFromDate: string | null;
  ageDays: number | null;
}

export interface SupplierPayableRow {
  supplierId: string;
  supplierName: string;
  poCount: number;
  orderedPoisha: number;
  receivedPoisha: number;
  paidPoisha: number;
  outstandingPoisha: number;
  aging: { d0_30: number; d31_60: number; d61_90: number; over90: number };
}

export interface PurchaseLedgerData {
  suppliers: SupplierPayableRow[];
  purchaseOrders: PurchaseLedgerPoRow[];
  totals: {
    orderedPoisha: number;
    receivedPoisha: number;
    paidPoisha: number;
    outstandingPoisha: number;
  };
  /** Posted supplier payments that name no known purchase order. */
  unattributedPaymentsPoisha: number;
  /** Always false today — see the header. */
  purchaseVatTracked: false;
}

function dhakaDateOf(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(`${toDate}T00:00:00.000Z`).getTime() - new Date(`${fromDate}T00:00:00.000Z`).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export async function getPurchaseLedger(now: Date = new Date()): Promise<PurchaseLedgerData> {
  const today = dhakaDateOf(now);

  const [supplierRows, paymentEntries] = await Promise.all([
    prisma.supplier.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        purchaseOrders: {
          where: { deletedAt: null, status: { not: "CANCELLED" } },
          orderBy: { createdAt: "asc" },
          include: { items: { select: { quantityReceived: true, costPoisha: true } } },
        },
      },
    }),
    prisma.erpJournalEntry.findMany({
      where: { sourceKind: "supplier_payment", status: "posted" },
      include: { lines: { include: { account: { select: { code: true } } } } },
    }),
  ]);

  // Payment amount per purchase order id. The typed builder's amount
  // is the Dr 2000 (accounts payable) line; fall back to total debits
  // for hand-written entries that skipped the payable account.
  const paidByPoId = new Map<string, number>();
  let unattributedPaymentsPoisha = 0;
  const knownPoIds = new Set<string>();
  for (const s of supplierRows) for (const po of s.purchaseOrders) knownPoIds.add(po.id);
  for (const entry of paymentEntries) {
    const apLine = entry.lines.find((l) => l.account.code === "2000" && l.debitPoisha > 0);
    const amount = apLine
      ? apLine.debitPoisha
      : entry.lines.reduce((s, l) => s + l.debitPoisha, 0);
    if (entry.sourceId && knownPoIds.has(entry.sourceId)) {
      paidByPoId.set(entry.sourceId, (paidByPoId.get(entry.sourceId) ?? 0) + amount);
    } else {
      unattributedPaymentsPoisha += amount;
    }
  }

  const purchaseOrders: PurchaseLedgerPoRow[] = [];
  const suppliers: SupplierPayableRow[] = [];
  const totals = { orderedPoisha: 0, receivedPoisha: 0, paidPoisha: 0, outstandingPoisha: 0 };

  for (const supplier of supplierRows) {
    const agg: SupplierPayableRow = {
      supplierId: supplier.id,
      supplierName: supplier.name,
      poCount: supplier.purchaseOrders.length,
      orderedPoisha: 0,
      receivedPoisha: 0,
      paidPoisha: 0,
      outstandingPoisha: 0,
      aging: { d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 },
    };
    for (const po of supplier.purchaseOrders) {
      const receivedPoisha = po.items.reduce((s, i) => s + i.quantityReceived * i.costPoisha, 0);
      const paidPoisha = paidByPoId.get(po.id) ?? 0;
      const outstandingPoisha = receivedPoisha - paidPoisha;
      const agingFrom = outstandingPoisha > 0 ? (po.receivedAt ?? po.createdAt) : null;
      const agingFromDate = agingFrom ? dhakaDateOf(agingFrom) : null;
      const ageDays = agingFromDate ? daysBetween(agingFromDate, today) : null;
      purchaseOrders.push({
        id: po.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        status: po.status,
        orderedPoisha: po.totalPoisha,
        receivedPoisha,
        paidPoisha,
        outstandingPoisha,
        agingFromDate,
        ageDays,
      });
      agg.orderedPoisha += po.totalPoisha;
      agg.receivedPoisha += receivedPoisha;
      agg.paidPoisha += paidPoisha;
      agg.outstandingPoisha += outstandingPoisha;
      if (outstandingPoisha > 0 && ageDays !== null) {
        if (ageDays <= 30) agg.aging.d0_30 += outstandingPoisha;
        else if (ageDays <= 60) agg.aging.d31_60 += outstandingPoisha;
        else if (ageDays <= 90) agg.aging.d61_90 += outstandingPoisha;
        else agg.aging.over90 += outstandingPoisha;
      }
    }
    suppliers.push(agg);
    totals.orderedPoisha += agg.orderedPoisha;
    totals.receivedPoisha += agg.receivedPoisha;
    totals.paidPoisha += agg.paidPoisha;
    totals.outstandingPoisha += agg.outstandingPoisha;
  }

  return {
    suppliers,
    purchaseOrders,
    totals,
    unattributedPaymentsPoisha,
    purchaseVatTracked: false,
  };
}
