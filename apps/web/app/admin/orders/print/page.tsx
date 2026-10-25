"use client";

/**
 * Print centre — invoices for the orders selected on the list page
 * (doc 17, batch O6-2). Opened in a new tab as
 * /admin/orders/print?ids=<id,id,...> from the list's
 * "ইনভয়েস প্রিন্ট / Print invoices" button.
 *
 * Each order is fetched from the existing detail API
 * (GET /api/v1/admin/orders/[id]) and rendered as one clean invoice;
 * the print stylesheet isolates the invoice root (the same
 * visibility trick the barcode labels studio uses) so no admin
 * chrome reaches paper, with a page break between invoices.
 * window.print() fires once after every fetch settles.
 *
 * Money lines, honestly: the detail API's order view does not expose
 * the subtotal / shipping / discount split (the repository mapper
 * omits those columns), so the invoice shows the exact items
 * subtotal (summed from the purchase-time snapshots), then ONE net
 * line — "delivery & adjustments, net of discount" = total −
 * subtotal — then the total. Paid comes from the advance read model
 * on the same payload (advance.paidPoisha); the due amount is
 * highlighted whenever the order is not fully PAID.
 *
 * The customer phone prints exactly as the detail API returned it:
 * full for viewers holding customers.view_full_phone, masked
 * otherwise — the API's own policy, not re-decided here.
 *
 * The invoice markup is NEW (the pre-existing PrintPanel on the
 * order detail is a simplified on-screen preview, not an invoice).
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { formatBdt } from "../../../../src/checkout/pricing";

const MAX_INVOICES = 50;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি (COD)",
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  card: "কার্ড",
  sslcommerz: "SSLCommerz",
};

interface InvoiceItem {
  variantId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  quantity: number;
}

interface InvoiceOrder {
  id: string;
  orderNo: string;
  customerName: string;
  customerPhone: string;
  address: {
    division?: string;
    district?: string;
    upazila?: string;
    union?: string;
    addressLine?: string;
  };
  items: InvoiceItem[];
  totalPoisha: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  createdAt: string;
  advance?: { paidPoisha: number } | null;
}

interface LoadedInvoice {
  order: InvoiceOrder;
  subtotalPoisha: number;
  netAdjustmentPoisha: number;
  paidPoisha: number;
  duePoisha: number;
}

function toInvoice(order: InvoiceOrder): LoadedInvoice {
  const subtotalPoisha = order.items.reduce(
    (sum, i) => sum + i.unitPricePoisha * i.quantity,
    0,
  );
  const paidPoisha =
    order.advance?.paidPoisha ??
    (order.paymentStatus === "PAID" ? order.totalPoisha : 0);
  return {
    order,
    subtotalPoisha,
    netAdjustmentPoisha: order.totalPoisha - subtotalPoisha,
    paidPoisha,
    duePoisha: Math.max(0, order.totalPoisha - paidPoisha),
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function PrintCentreInner() {
  const searchParams = useSearchParams();
  const ids = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const unique = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
    return unique.slice(0, MAX_INVOICES);
  }, [searchParams]);

  const [invoices, setInvoices] = useState<LoadedInvoice[] | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [storeName, setStoreName] = useState("");
  const printedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Store identity is a nicety, never a blocker: a failed or
      // empty settings read just omits the store-name line.
      try {
        const res = await fetch("/api/v1/admin/settings");
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { data?: { publicSettings?: Record<string, string> } }
            | null;
          const name = body?.data?.publicSettings?.["general.store_name"];
          if (!cancelled && typeof name === "string" && name.trim()) {
            setStoreName(name.trim());
          }
        }
      } catch {
        /* no store line */
      }

      const results = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(id)}`);
            if (!res.ok) return { id, ok: false as const };
            const body = (await res.json().catch(() => null)) as
              | { data?: InvoiceOrder }
              | null;
            if (!body?.data) return { id, ok: false as const };
            return { id, ok: true as const, invoice: toInvoice(body.data) };
          } catch {
            return { id, ok: false as const };
          }
        }),
      );
      if (cancelled) return;
      setInvoices(results.filter((r) => r.ok).map((r) => r.invoice));
      setFailedIds(results.filter((r) => !r.ok).map((r) => r.id));
    })();
    return () => {
      cancelled = true;
    };
  }, [ids]);

  /* Auto-print once everything has settled and at least one invoice
   * rendered; a ref guard keeps React re-renders from re-firing it. */
  useEffect(() => {
    if (invoices === null || invoices.length === 0 || printedRef.current) return;
    printedRef.current = true;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [invoices]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* Print isolation, mirroring the labels studio: only the
          invoice root is visible on paper; screen-only controls and
          notes carry print:hidden so they never reach the sheet. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #order-invoice-print, #order-invoice-print * { visibility: visible !important; }
          #order-invoice-print { position: absolute !important; left: 0; top: 0; width: 100%; }
          .invoice-sheet { break-after: page; }
          .invoice-sheet:last-child { break-after: auto; }
          @page { margin: 12mm; }
        }
      `}</style>

      <div className="mb-5 flex flex-wrap items-center gap-3 print:hidden">
        <div>
          <h1 className="text-h2">ইনভয়েস প্রিন্ট</h1>
          <p className="text-small text-text-muted">
            {ids.length === 0
              ? "কোনো অর্ডার সিলেক্ট করা হয়নি — অর্ডার তালিকা থেকে সিলেক্ট করে আবার আসুন।"
              : invoices === null
                ? `${ids.length}টি অর্ডারের ইনভয়েস লোড হচ্ছে…`
                : `${invoices.length}টি ইনভয়েস তৈরি${failedIds.length > 0 ? ` · ${failedIds.length}টি লোড হয়নি` : ""}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!invoices || invoices.length === 0}
          className="ml-auto rounded-md bg-brand-600 px-4 py-2 text-small font-semibold text-white disabled:opacity-50"
        >
          আবার প্রিন্ট করুন
        </button>
      </div>

      {failedIds.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-small text-rose-700 print:hidden">
          এই অর্ডারগুলো লোড হয়নি (মুছে ফেলা বা অ্যাক্সেস নেই): {failedIds.join(", ")}
        </div>
      )}

      {invoices !== null && invoices.length === 0 && ids.length > 0 && (
        <p className="text-small text-text-muted print:hidden">কোনো ইনভয়েস তৈরি হয়নি।</p>
      )}

      <div id="order-invoice-print">
        {(invoices ?? []).map(({ order, subtotalPoisha, netAdjustmentPoisha, paidPoisha, duePoisha }) => (
          <section
            key={order.id}
            className="invoice-sheet mb-8 rounded-lg border border-border bg-white p-6 text-text-main shadow-card print:mb-0 print:rounded-none print:border-0 print:shadow-none"
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
              <div>
                {storeName && <p className="text-h3 font-bold">{storeName}</p>}
                <p className="text-small text-text-muted">ইনভয়েস / Invoice</p>
              </div>
              <div className="text-right">
                <p className="font-mono text-body font-bold">{order.orderNo}</p>
                <p className="text-small text-text-muted">{formatDate(order.createdAt)}</p>
              </div>
            </header>

            <div className="mt-4 text-small leading-relaxed">
              <p className="font-semibold">{order.customerName}</p>
              <p>{order.customerPhone}</p>
              <p className="text-text-muted">
                {[
                  order.address.addressLine,
                  order.address.union,
                  order.address.upazila,
                  order.address.district,
                  order.address.division,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="mt-1 text-text-muted">
                পেমেন্ট: {PAYMENT_METHOD_LABELS[order.paymentMethod] ?? order.paymentMethod}
              </p>
            </div>

            <table className="mt-5 w-full text-left text-small">
              <thead>
                <tr className="border-b border-border text-text-muted">
                  <th scope="col" className="py-2 font-medium">পণ্য</th>
                  <th scope="col" className="py-2 text-center font-medium">পরিমাণ</th>
                  <th scope="col" className="py-2 text-right font-medium">একক দাম</th>
                  <th scope="col" className="py-2 text-right font-medium">মোট</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.variantId} className="border-b border-border/60">
                    <td className="py-2">
                      <span className="font-medium">{item.productName}</span>
                      <span className="block text-caption text-text-muted">{item.sku}</span>
                    </td>
                    <td className="py-2 text-center tabular-nums">{item.quantity}</td>
                    <td className="py-2 text-right tabular-nums">{formatBdt(item.unitPricePoisha)}</td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {formatBdt(item.unitPricePoisha * item.quantity)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <dl className="mt-4 space-y-1.5 text-small">
              <div className="flex justify-between">
                <dt className="text-text-muted">সাবটোটাল (পণ্য)</dt>
                <dd className="tabular-nums">{formatBdt(subtotalPoisha)}</dd>
              </div>
              {netAdjustmentPoisha !== 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">ডেলিভারি চার্জ ও সমন্বয় (ছাড় বাদে নিট)</dt>
                  <dd className="tabular-nums">{formatBdt(netAdjustmentPoisha)}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-border pt-2 text-body font-bold">
                <dt>সর্বমোট</dt>
                <dd className="tabular-nums">{formatBdt(order.totalPoisha)}</dd>
              </div>
              {paidPoisha > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">পরিশোধিত</dt>
                  <dd className="tabular-nums">{formatBdt(paidPoisha)}</dd>
                </div>
              )}
            </dl>

            {order.paymentStatus !== "PAID" && duePoisha > 0 ? (
              <div className="mt-5 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3">
                <p className="text-body font-bold text-amber-900">
                  সংগ্রহ করুন / Amount due: {formatBdt(duePoisha)}
                </p>
                <p className="text-caption text-amber-800">
                  ডেলিভারির সময় কাস্টমারের কাছ থেকে এই পরিমাণ টাকা সংগ্রহ করতে হবে।
                </p>
              </div>
            ) : (
              <p className="mt-5 rounded-md bg-emerald-50 px-4 py-3 text-small font-semibold text-emerald-800">
                সম্পূর্ণ পরিশোধিত / Paid in full
              </p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

export default function OrderPrintPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl p-6 text-small text-text-muted">লোড হচ্ছে…</main>}>
      <PrintCentreInner />
    </Suspense>
  );
}
