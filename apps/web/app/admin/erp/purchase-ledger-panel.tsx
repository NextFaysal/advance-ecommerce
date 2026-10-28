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
    pos: <span className="tnum">{s.poCount}</span>,
    ordered: <Money poisha={s.orderedPoisha} />,
    received: <Money poisha={s.receivedPoisha} />,
    paid: <Money poisha={s.paidPoisha} />,
    outstanding: <Money poisha={s.outstandingPoisha} />,
    aging:
      s.outstandingPoisha > 0 ? (
        <span className="tnum">
          {interpolate(str.plAging, { a: s.aging.d0_30, b: s.aging.d31_60, c: s.aging.d61_90, d: s.aging.over90 })}
        </span>
      ) : (
        "—"
      ),
  }));

  const poRows = ledger.purchaseOrders.map((po) => ({
    supplier: po.supplierName,
    status: po.status,
    ordered: <Money poisha={po.orderedPoisha} />,
    received: <Money poisha={po.receivedPoisha} />,
    paid: <Money poisha={po.paidPoisha} />,
    outstanding: <Money poisha={po.outstandingPoisha} />,
    age:
      po.ageDays !== null ? (
        <span className="tnum">{interpolate(str.plAgeDays, { days: po.ageDays, date: po.agingFromDate ?? "" })}</span>
      ) : (
        "—"
      ),
  }));

  return (
    <section className="space-y-4">
      <div className="space-y-3">
        <h2 className="font-display text-lg font-semibold">{str.plTitle}</h2>
        <p className="max-w-3xl text-sm text-text-muted">
          {str.plIntroBefore}
          {ledger.unattributedPaymentsPoisha > 0
            ? interpolate(str.plUnattributed, { amount: ledger.unattributedPaymentsPoisha })
            : ""}
          {str.plIntroAfter}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <div className="text-xs text-text-muted">{str.plTotalOrdered}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.orderedPoisha} /></div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <div className="text-xs text-text-muted">{str.plTotalReceived}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.receivedPoisha} /></div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <div className="text-xs text-text-muted">{str.plTotalPaid}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.paidPoisha} /></div>
        </div>
        <div className="rounded-2xl border border-border/60 bg-surface-2 p-4">
          <div className="text-xs text-text-muted">{str.plTotalOutstanding}</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.outstandingPoisha} /></div>
        </div>
      </div>
      <div className="space-y-3 md:hidden">
        {supplierRows.map((r, i) => (
          <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between gap-2">
              {r.supplier}
              <span className="text-sm">
                <span className="text-xs text-text-muted">{str.colPoCount} </span>
                {r.pos}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-sm">
              <span>
                <span className="block text-xs text-text-muted">{str.colOrdered}</span>
                {r.ordered}
              </span>
              <span>
                <span className="block text-xs text-text-muted">{str.colReceived}</span>
                {r.received}
              </span>
              <span>
                <span className="block text-xs text-text-muted">{str.colPaid}</span>
                {r.paid}
              </span>
              <span>
                <span className="block text-xs text-text-muted">{str.colOutstanding}</span>
                {r.outstanding}
              </span>
            </div>
            <p className="text-sm">
              <span className="text-xs text-text-muted">{str.colAging} </span>
              {r.aging}
            </p>
          </div>
        ))}
      </div>
      <div className="hidden md:block">
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
      </div>
      {poRows.length > 0 ? (
        <>
          <div className="space-y-3 md:hidden">
            {poRows.map((r, i) => (
              <div key={i} className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{r.supplier}</span>
                  <span className="text-sm">{r.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 border-t border-border pt-2 text-sm">
                  <span>
                    <span className="block text-xs text-text-muted">{str.colOrdered}</span>
                    {r.ordered}
                  </span>
                  <span>
                    <span className="block text-xs text-text-muted">{str.colReceived}</span>
                    {r.received}
                  </span>
                  <span>
                    <span className="block text-xs text-text-muted">{str.colPaid}</span>
                    {r.paid}
                  </span>
                  <span>
                    <span className="block text-xs text-text-muted">{str.colOutstanding}</span>
                    {r.outstanding}
                  </span>
                </div>
                <p className="text-sm">
                  <span className="text-xs text-text-muted">{str.colAge} </span>
                  {r.age}
                </p>
              </div>
            ))}
          </div>
          <div className="hidden md:block">
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
        </>
      ) : null}
    </section>
  );
}
