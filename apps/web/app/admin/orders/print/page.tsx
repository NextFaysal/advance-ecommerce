"use client";

/**
 * Print centre v2 — invoices + packing slips for the orders selected
 * on the list page (doc 17, batch O6-2; design OD5, doc 19). Opened in
 * a new tab as /admin/orders/print?ids=<id,id,...> from the list's
 * "ইনভয়েস প্রিন্ট / Print invoices" button.
 *
 * Each order is fetched from the existing detail API
 * (GET /api/v1/admin/orders/[id]) and rendered as one clean invoice;
 * the print stylesheet isolates the invoice root (the same
 * visibility trick the barcode labels studio uses) so no admin
 * chrome reaches paper, with a page break between invoices.
 * window.print() fires once after every fetch settles.
 *
 * OD5 design additions (presentation ONLY — the money computation in
 * toInvoice below is a contract and is unchanged):
 * - Brand block: store tile + the store name from the SAME settings
 *   source the platform uses (admin settings publicSettings,
 *   `general.store_name`). That key's default is EMPTY and there is
 *   no logo/contact setting anywhere in the settings registry, so
 *   when no name is set the masthead honestly prints without one (a
 *   screen-only hint says where the name comes from) — no invented
 *   brand, logo or phone number is ever printed.
 * - Packing-slip variant: items + big-type address, NO money at all.
 * - Format choice: A4 (default) or thermal 4×6 — @page size + sheet
 *   width via print CSS classes. The isolation rules and the print
 *   root structure are byte-identical to v1; only the @page line and
 *   an additive thermal width rule differ.
 *
 * Money lines, honestly: the detail API's order view exposes the
 * persisted shippingPoisha / discountPoisha split (doc 18, F1 — the
 * repository mapper carries both columns), so the invoice shows the
 * exact items subtotal (summed from the purchase-time snapshots),
 * then the real lines — delivery charge, discount when > 0, and any
 * residual (COD fee / tax) as one labelled remainder so the lines
 * always sum to the total. A payload that predates the split (no
 * numeric shipping/discount fields) falls back to the old ONE net
 * line — "delivery & adjustments, net of discount" = total −
 * subtotal. Paid comes from the advance read model on the same
 * payload (advance.paidPoisha); the due amount is highlighted
 * whenever the order is not fully PAID.
 *
 * The customer phone prints exactly as the detail API returned it:
 * full for viewers holding customers.view_full_phone, masked
 * otherwise — the API's own policy, not re-decided here.
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icon";
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
  /** Persisted money split (doc 18, F1). Optional: payloads that
   *  predate the mapper change carry neither field and the invoice
   *  falls back to the net-adjustment line for that order. */
  shippingPoisha?: number;
  discountPoisha?: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  createdAt: string;
  advance?: { paidPoisha: number } | null;
}

interface LoadedInvoice {
  order: InvoiceOrder;
  subtotalPoisha: number;
  /** null = the payload carried no numeric split for this order —
   *  render the fallback net line instead of the real lines. */
  shippingPoisha: number | null;
  discountPoisha: number | null;
  /** Residual charges inside the total that are neither shipping nor
   *  discount (COD fee / tax): total − (subtotal − discount +
   *  shipping). Shown only in split mode and only when non-zero, so
   *  the printed lines always reconcile to the total. */
  otherPoisha: number;
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
  const hasSplit =
    typeof order.shippingPoisha === "number" && typeof order.discountPoisha === "number";
  const shippingPoisha = hasSplit ? (order.shippingPoisha as number) : null;
  const discountPoisha = hasSplit ? (order.discountPoisha as number) : null;
  return {
    order,
    subtotalPoisha,
    shippingPoisha,
    discountPoisha,
    otherPoisha:
      shippingPoisha !== null && discountPoisha !== null
        ? order.totalPoisha - (subtotalPoisha - discountPoisha + shippingPoisha)
        : 0,
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

function addressText(order: InvoiceOrder): string {
  return [
    order.address.addressLine,
    order.address.union,
    order.address.upazila,
    order.address.district,
    order.address.division,
  ]
    .filter(Boolean)
    .join(", ");
}

type PrintVariant = "invoice" | "slip";
type PrintFormat = "a4" | "thermal";

function InvoiceSheet({
  invoice,
  storeName,
  format,
}: {
  invoice: LoadedInvoice;
  storeName: string;
  format: PrintFormat;
}) {
  const { order, subtotalPoisha, shippingPoisha, discountPoisha, otherPoisha, netAdjustmentPoisha, paidPoisha, duePoisha } = invoice;
  return (
    <section
      className={`invoice-sheet mb-8 rounded-lg border border-border bg-white p-6 text-text-main shadow-card print:mb-0 print:rounded-none print:border-0 print:shadow-none ${
        format === "thermal" ? "invoice-sheet--thermal mx-auto w-full max-w-[104mm]" : ""
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-brand-600 pb-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="store" size={22} />
          </span>
          <div>
            {storeName && <p className="text-h2 font-bold leading-tight">{storeName}</p>}
            <p className="text-small font-semibold uppercase tracking-wide text-text-muted">ইনভয়েস / Invoice</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-body font-bold">{order.orderNo}</p>
          <p className="text-small text-text-muted">{formatDate(order.createdAt)}</p>
        </div>
      </header>

      <div className="mt-4 text-small leading-relaxed">
        <p className="font-semibold">{order.customerName}</p>
        <p>{order.customerPhone}</p>
        <p className="text-text-muted">{addressText(order)}</p>
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

      <div className="mt-4 rounded-lg border border-border bg-slate-50/60 px-4 py-3 print:bg-transparent">
        <dl className="space-y-1.5 text-small">
          <div className="flex justify-between">
            <dt className="text-text-muted">সাবটোটাল (পণ্য)</dt>
            <dd className="tabular-nums">{formatBdt(subtotalPoisha)}</dd>
          </div>
          {shippingPoisha !== null && discountPoisha !== null ? (
            <>
              <div className="flex justify-between">
                <dt className="text-text-muted">ডেলিভারি চার্জ</dt>
                <dd className="tabular-nums">{formatBdt(shippingPoisha)}</dd>
              </div>
              {discountPoisha > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">ছাড়</dt>
                  <dd className="tabular-nums">−{formatBdt(discountPoisha)}</dd>
                </div>
              )}
              {otherPoisha !== 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">সিওডি ফি ও অন্যান্য চার্জ</dt>
                  <dd className="tabular-nums">{formatBdt(otherPoisha)}</dd>
                </div>
              )}
            </>
          ) : (
            netAdjustmentPoisha !== 0 && (
              <div className="flex justify-between">
                <dt className="text-text-muted">ডেলিভারি চার্জ ও সমন্বয় (ছাড় বাদে নিট)</dt>
                <dd className="tabular-nums">{formatBdt(netAdjustmentPoisha)}</dd>
              </div>
            )
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
      </div>

      {order.paymentStatus !== "PAID" && duePoisha > 0 ? (
        <div className="mt-5 rounded-md border-2 border-amber-400 bg-amber-50 px-4 py-3">
          <p className="flex items-center gap-2 text-body font-bold text-amber-900">
            <Icon name="banknote" size={20} />
            <span>
              সংগ্রহ করুন / Amount due: {formatBdt(duePoisha)}
            </span>
          </p>
          <p className="mt-1 text-caption text-amber-800">
            ডেলিভারির সময় কাস্টমারের কাছ থেকে এই পরিমাণ টাকা সংগ্রহ করতে হবে।
          </p>
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-md bg-emerald-50 px-4 py-3 text-small font-semibold text-emerald-800">
          <Icon name="check" size={16} />
          সম্পূর্ণ পরিশোধিত / Paid in full
        </p>
      )}
    </section>
  );
}

function PackingSlipSheet({
  invoice,
  storeName,
  format,
}: {
  invoice: LoadedInvoice;
  storeName: string;
  format: PrintFormat;
}) {
  const { order } = invoice;
  const totalQuantity = order.items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <section
      className={`invoice-sheet mb-8 rounded-lg border border-border bg-white p-6 text-text-main shadow-card print:mb-0 print:rounded-none print:border-0 print:shadow-none ${
        format === "thermal" ? "invoice-sheet--thermal mx-auto w-full max-w-[104mm]" : ""
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-brand-600 pb-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Icon name="package" size={22} />
          </span>
          <div>
            {storeName && <p className="text-h3 font-bold leading-tight">{storeName}</p>}
            <p className="text-small font-semibold uppercase tracking-wide text-text-muted">প্যাকিং স্লিপ / Packing slip</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-body font-bold">{order.orderNo}</p>
          <p className="text-small text-text-muted">{formatDate(order.createdAt)}</p>
        </div>
      </header>

      <div className="mt-5 leading-relaxed">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">ডেলিভারি ঠিকানা</p>
        <p className="mt-1 text-h2 font-bold leading-snug">{order.customerName}</p>
        <p className="font-mono text-h3 font-semibold">{order.customerPhone}</p>
        <p className="mt-1 text-body font-medium leading-relaxed">{addressText(order)}</p>
      </div>

      <table className="mt-5 w-full text-left">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-2 text-small font-medium">পণ্য</th>
            <th scope="col" className="py-2 text-right text-small font-medium">পরিমাণ</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.variantId} className="border-b border-border/60">
              <td className="py-2.5">
                <span className="text-body font-semibold">{item.productName}</span>
                <span className="block text-caption text-text-muted">{item.sku}</span>
              </td>
              <td className="py-2.5 text-right text-h3 font-bold tabular-nums">× {item.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-4 flex items-center gap-2 text-body font-semibold">
        <Icon name="box" size={18} />
        মোট আইটেম: {totalQuantity}টি
      </p>
      <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-caption text-text-muted print:bg-transparent">
        এই স্লিপে টাকার হিসাব নেই — টাকার জন্য ইনভয়েসটি দেখুন।
      </p>
    </section>
  );
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
  const [variant, setVariant] = useState<PrintVariant>("invoice");
  const [format, setFormat] = useState<PrintFormat>("a4");
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

  const toggleBtnCls = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-small font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${
      active ? "bg-brand-600 text-white" : "bg-surface text-text-muted ring-1 ring-border hover:text-text-main"
    }`;

  return (
    <main className="mx-auto max-w-3xl p-6">
      {/* Print isolation, mirroring the labels studio: only the
          invoice root is visible on paper; screen-only controls and
          notes carry print:hidden so they never reach the sheet. The
          isolation rules are v1's, unchanged — OD5 only parameterises
          the @page line by format and adds the thermal sheet width. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #order-invoice-print, #order-invoice-print * { visibility: visible !important; }
          #order-invoice-print { position: absolute !important; left: 0; top: 0; width: 100%; }
          .invoice-sheet { break-after: page; }
          .invoice-sheet:last-child { break-after: auto; }
          .invoice-sheet--thermal { width: 100mm !important; margin-left: auto; margin-right: auto; }
          @page { ${format === "thermal" ? "size: 4in 6in; margin: 4mm;" : "margin: 12mm;"} }
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
          {invoices !== null && !storeName && (
            <p className="mt-1 text-caption text-text-muted">
              স্টোরের নাম Settings → General (general.store_name) থেকে আসে — এখনো সেট হয়নি, তাই শিরোনামে নাম ছাপা হচ্ছে না।
            </p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label="প্রিন্টের ধরন">
            <button type="button" aria-pressed={variant === "invoice"} onClick={() => setVariant("invoice")} className={toggleBtnCls(variant === "invoice")}>
              ইনভয়েস
            </button>
            <button type="button" aria-pressed={variant === "slip"} onClick={() => setVariant("slip")} className={toggleBtnCls(variant === "slip")}>
              প্যাকিং স্লিপ
            </button>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="কাগজের ফরম্যাট">
            <button type="button" aria-pressed={format === "a4"} onClick={() => setFormat("a4")} className={toggleBtnCls(format === "a4")}>
              A4
            </button>
            <button type="button" aria-pressed={format === "thermal"} onClick={() => setFormat("thermal")} className={toggleBtnCls(format === "thermal")}>
              থার্মাল 4×6
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!invoices || invoices.length === 0}
            className="rounded-md bg-brand-600 px-4 py-2 text-small font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            আবার প্রিন্ট করুন
          </button>
        </div>
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
        {(invoices ?? []).map((invoice) =>
          variant === "invoice" ? (
            <InvoiceSheet key={invoice.order.id} invoice={invoice} storeName={storeName} format={format} />
          ) : (
            <PackingSlipSheet key={invoice.order.id} invoice={invoice} storeName={storeName} format={format} />
          ),
        )}
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
