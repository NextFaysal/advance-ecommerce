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

export async function PurchaseLedgerPanel() {
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
        ? `০–৩০দি: ${s.aging.d0_30} · ৩১–৬০দি: ${s.aging.d31_60} · ৬১–৯০দি: ${s.aging.d61_90} · ৯০দি+: ${s.aging.over90} (পয়সা)`
        : "—",
  }));

  const poRows = ledger.purchaseOrders.map((po) => ({
    supplier: po.supplierName,
    status: po.status,
    ordered: <Money poisha={po.orderedPoisha} />,
    received: <Money poisha={po.receivedPoisha} />,
    paid: <Money poisha={po.paidPoisha} />,
    outstanding: <Money poisha={po.outstandingPoisha} />,
    age: po.ageDays !== null ? `${po.ageDays} দিন (${po.agingFromDate})` : "—",
  }));

  return (
    <section>
      <h2 className="mb-3 mt-8 text-lg font-semibold">ক্রয় খাতা — সরবরাহকারী দেনা (Purchase ledger)</h2>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">
        বকেয়া = গৃহীত পণ্যের মূল্য − পরিশোধিত। সিস্টেমে এখনো কোনো PO-গ্রহণ (receive) ফ্লো নেই —
        quantityReceived কোথাও লেখা হয় না — তাই গৃহীত/বকেয়া অঙ্ক গ্রহণ রেকর্ড না হওয়া পর্যন্ত ০ থাকবে;
        শুধু অর্ডার দেখে দেনা অনুমান করা হয়নি। পরিশোধ = পোস্ট করা supplier_payment জার্নাল এন্ট্রি,
        PO-এর মাধ্যমে সরবরাহকারীর সাথে যুক্ত।
        {ledger.unattributedPaymentsPoisha > 0
          ? ` PO-ছাড়া পরিশোধ: ${ledger.unattributedPaymentsPoisha} পয়সা (কোনো সরবরাহকারীতে বসানো হয়নি)।`
          : ""}
        {" "}ক্রয়-পক্ষের ভ্যাট ট্র্যাক করা হয় না (PO আইটেমে ভ্যাট বিভাজন নেই) — ভ্যাট রিপোর্ট আগের মতোই শুধু বিক্রয়ের।
      </p>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">মোট অর্ডারকৃত</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.orderedPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">মোট গৃহীত</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.receivedPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">মোট পরিশোধিত</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.paidPoisha} /></div>
        </div>
        <div className="rounded-md border border-border p-3">
          <div className="text-xs text-text-muted">মোট বকেয়া (গৃহীত − পরিশোধিত)</div>
          <div className="text-lg font-semibold"><Money poisha={ledger.totals.outstandingPoisha} /></div>
        </div>
      </div>
      <DataTable
        caption="সরবরাহকারী অনুযায়ী দেনা ও মেয়াদ (aging)"
        columns={[
          { key: "supplier", header: "সরবরাহকারী" },
          { key: "pos", header: "PO সংখ্যা" },
          { key: "ordered", header: "অর্ডারকৃত" },
          { key: "received", header: "গৃহীত" },
          { key: "paid", header: "পরিশোধিত" },
          { key: "outstanding", header: "বকেয়া" },
          { key: "aging", header: "মেয়াদ বিভাজন" },
        ]}
        rows={supplierRows}
      />
      {poRows.length > 0 ? (
        <div className="mt-4">
          <DataTable
            caption="ক্রয় আদেশ (PO) অনুযায়ী বিবরণ"
            columns={[
              { key: "supplier", header: "সরবরাহকারী" },
              { key: "status", header: "অবস্থা" },
              { key: "ordered", header: "অর্ডারকৃত" },
              { key: "received", header: "গৃহীত" },
              { key: "paid", header: "পরিশোধিত" },
              { key: "outstanding", header: "বকেয়া" },
              { key: "age", header: "বয়স" },
            ]}
            rows={poRows}
          />
        </div>
      ) : null}
    </section>
  );
}
