/**
 * Purchase ledger panel (ADV-11) — a section on the ERP page, fed by
 * the server read model in src/erp/purchase-ledger.ts: per-supplier
 * ordered / received / paid / outstanding with aging buckets.
 *
 * Honesty notes rendered on the panel itself:
 *  - "Received" is what PurchaseOrderItem.quantityReceived records.
 *    No PO receive flow exists in the system yet, so received (and
 *    therefore outstanding) figures stay 0 until one is built — the
 *    panel says so instead of implying supplier debt from orders
 *    alone. Outstanding = received − paid, by definition.
 *  - Payments are POSTED supplier_payment journal entries attributed
 *    through their purchase order; unattributed ones are shown as
 *    their own line, never guessed onto a supplier.
 *  - Purchase-side VAT is not tracked (PO items carry no VAT split),
 *    so the VAT report above remains sales-only.
 */
import { DataTable } from "@/components/ui/table";
import { Money } from "@/components/ui/money";
import { getPurchaseLedger } from "@/erp/purchase-ledger";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { ERP_STRINGS } from "./strings";

export async function PurchaseLedgerPanel() {
  const locale = await getRequestLocale();
  const str = pick(locale, ERP_STRINGS);
  const ledger = await getPurchaseLedger();

  const supplierRows = ledger.suppliers.map((s) => ({
    supplier: <span className="font-medium">{s.supplierName}</span>,
    pos: String(s.poCount),
    ordered: <Money poisha={s.orderedPoisha} />,
    received: <Money poisha={s.receivedPoisha} />,
    paid: <Money poisha={s.paidPoisha} />,
    outstanding: <Money poisha={s.outstandingPoisha} />,
    aging:
      s.outstandingPoisha > 0
        ? interpolate(str.plAging, { a: s.aging.d0_30, b: s.aging.d31_60, c: s.aging.d61_90, d: s.aging.over90 })
        : "—",
  }));

  const poRows = ledger.purchaseOrders.map((po) => ({
    supplier: po.supplierName,
    status: po.status,
    ordered: <Money poisha={po.orderedPoisha} />,
    received: <Money poisha={po.receivedPoisha} />,
    paid: <Money poisha={po.paidPoisha} />,
    outstanding: <Money poisha={po.outstandingPoisha} />,
    age: po.ageDays !== null ? interpolate(str.plAgeDays, { days: po.ageDays, date: po.agingFromDate ?? "" }) : "—",
  }));

  return (
    <section>
      <h2 className="mb-3 mt-8 text-lg font-semibold">{str.plTitle}</h2>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">
        {str.plIntroBefore}
        {ledger.unattributedPaymentsPoisha > 0
          ? interpolate(str.plUnattributed, { amount: ledger.unattributedPaymentsPoisha })
          : ""}
        {str.plIntroAfter}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">{str.plTotalOrdered}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.orderedPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">{str.plTotalReceived}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.receivedPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">{str.plTotalPaid}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.paidPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">{str.plTotalOutstanding}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.outstandingPoisha} /></div>
        </div>
      </div>
      <DataTable
        caption={str.plCaptionSuppliers}
        columns={[
          { key: "supplier", header: str.colSupplier },
          { key: "pos", header: str.colPoCount },
          { key: "ordered", header: str.colOrdered },
          { key: "received", header: str.colReceived },
          { key: "paid", header: str.colPaid },
          { key: "outstanding", header: str.colOutstanding },
          { key: "aging", header: str.colAging },
        ]}
        rows={supplierRows}
      />
      {poRows.length > 0 ? (
        <div className="mt-4">
          <DataTable
            caption={str.plCaptionPos}
            columns={[
              { key: "supplier", header: str.colSupplier },
              { key: "status", header: str.colStatus },
              { key: "ordered", header: str.colOrdered },
              { key: "received", header: str.colReceived },
              { key: "paid", header: str.colPaid },
              { key: "outstanding", header: str.colOutstanding },
              { key: "age", header: str.colAge },
            ]}
            rows={poRows}
          />
        </div>
      ) : null}
    </section>
  );
}
