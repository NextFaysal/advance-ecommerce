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
 * Gift card (wave 52, mirroring the PDF invoice read model in
 * src/pdf/invoice-data.ts): Order.totalPoisha is the amount due
 * AFTER gift-card coverage, so a redeemed card used to hide inside
 * the residual above (as a smaller — sometimes negative — "COD fee
 * & other charges" line). The detail payload now carries the
 * ledger-derived coverage as giftCard { netPoisha, codeLast4 }; the
 * residual is computed against the GROSS total (total + gift card),
 * and when a card covered part of the order the sheet prints the
 * PDF's own rows — "মোট (গিফট কার্ডের আগে)" then the gift-card
 * tender as a negative line — before the সর্বমোট total, so gross −
 * gift card = total exactly. Payloads predating the giftCard field
 * read as zero coverage (the old arithmetic, unchanged).
 *
 * The customer phone prints exactly as the detail API returned it:
 * full for viewers holding customers.view_full_phone, masked
 * otherwise — the API's own policy, not re-decided here.
 *
 * Template copy (ADV-29): the invoice sheet also prints the
 * merchant's header note / terms line / footer note from
 * src/templates/overrides.ts, fetched resolved from the
 * templates admin API — the same slots the PDF invoice renders.
 * Unset slots print nothing here (this surface never had a
 * built-in footer; the PDF's built-in footer default stays the
 * PDF's own business).
 */
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { formatBdt } from "../../../../src/checkout/pricing";
import { addQty, lineTotalPoisha } from "../../../../src/lib/quantity";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";
import { formatOrderDate } from "../list-helpers";

const MAX_INVOICES = 50;

const PAYMENT_METHOD_LABELS: Record<string, Record<Locale, string>> = {
  cod: { bn: "ক্যাশ অন ডেলিভারি (COD)", en: "Cash on delivery (COD)" },
  bkash: { bn: "বিকাশ", en: "bKash" },
  nagad: { bn: "নগদ", en: "Nagad" },
  rocket: { bn: "রকেট", en: "Rocket" },
  card: { bn: "কার্ড", en: "Card" },
  sslcommerz: { bn: "SSLCommerz", en: "SSLCommerz" },
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
  /** Gift-card coverage from the GiftCardTransaction ledger
   *  (detail API's data.giftCard). Optional: payloads predating the
   *  field read as zero coverage. */
  giftCard?: { netPoisha: number; codeLast4: string | null } | null;
  /** Rental view from the RentalBooking row (detail API's
   *  data.rental, ADV-23 vertical 3). Optional: payloads predating
   *  the field / non-rental orders read as no deposit. */
  rental?: { depositPoisha: number } | null;
  /** POD view parsed from the order note (detail API's data.pod,
   *  ADV-23 vertical 5). Optional: payloads predating the field /
   *  non-POD orders read as no print fee. feePoisha only — the
   *  money split needs nothing else. */
  pod?: { feePoisha: number } | null;
}

interface LoadedInvoice {
  order: InvoiceOrder;
  subtotalPoisha: number;
  /** null = the payload carried no numeric split for this order —
   *  render the fallback net line instead of the real lines. */
  shippingPoisha: number | null;
  discountPoisha: number | null;
  /** Residual charges inside the GROSS total that are neither
   *  shipping nor discount (COD fee / tax): gross − (subtotal −
   *  discount + shipping), where gross = totalPoisha + gift-card
   *  coverage. The gift-card tender is NOT in here any more — it
   *  prints as its own line. Shown only in split mode and only when
   *  non-zero, so the printed lines always reconcile to the total. */
  otherPoisha: number;
  netAdjustmentPoisha: number;
  /** Net gift-card coverage (>= 0) and the card's last-4, from the
   *  ledger via the detail payload; 0 / null when no card was used. */
  giftCardNetPoisha: number;
  giftCardLast4: string | null;
  /** Rental security deposit frozen on the RentalBooking (ADV-23),
   *  already inside the total — printed as its own line and taken
   *  out of otherPoisha; 0 for non-rental orders. */
  rentalDepositPoisha: number;
  /** Print-on-demand print fee frozen on the order note (ADV-23
   *  vertical 5), already inside the total — printed as its own
   *  line and taken out of otherPoisha; 0 for non-POD orders. */
  printFeePoisha: number;
  /** Total before the gift-card tender: totalPoisha + coverage. */
  grossTotalPoisha: number;
  paidPoisha: number;
  duePoisha: number;
}

function toInvoice(order: InvoiceOrder): LoadedInvoice {
  const subtotalPoisha = order.items.reduce(
    (sum, i) => sum + lineTotalPoisha(i.unitPricePoisha, i.quantity),
    0,
  );
  const paidPoisha =
    order.advance?.paidPoisha ??
    (order.paymentStatus === "PAID" ? order.totalPoisha : 0);
  const hasSplit =
    typeof order.shippingPoisha === "number" && typeof order.discountPoisha === "number";
  const shippingPoisha = hasSplit ? (order.shippingPoisha as number) : null;
  const discountPoisha = hasSplit ? (order.discountPoisha as number) : null;
  // Gift-card decomposition, mirroring src/pdf/invoice-data.ts:
  // totalPoisha is post-coverage, so the money lines are built
  // against the gross total and the card prints as its own tender.
  const giftCardNetPoisha = Math.max(0, order.giftCard?.netPoisha ?? 0);
  const grossTotalPoisha = order.totalPoisha + giftCardNetPoisha;
  // ADV-23 rental deposit: inside the total already; decomposed
  // out of the residual so it prints as its own line (the PDF
  // invoice's discipline in src/pdf/invoice-data).
  const rentalDepositPoisha = Math.max(0, order.rental?.depositPoisha ?? 0);
  // ADV-23 vertical 5 print fee: same decomposition discipline.
  const printFeePoisha = Math.max(0, order.pod?.feePoisha ?? 0);
  return {
    order,
    subtotalPoisha,
    shippingPoisha,
    discountPoisha,
    otherPoisha:
      shippingPoisha !== null && discountPoisha !== null
        ? grossTotalPoisha -
          (subtotalPoisha - discountPoisha + shippingPoisha + rentalDepositPoisha + printFeePoisha)
        : 0,
    netAdjustmentPoisha: grossTotalPoisha - subtotalPoisha,
    giftCardNetPoisha,
    giftCardLast4: order.giftCard?.codeLast4 ?? null,
    rentalDepositPoisha,
    printFeePoisha,
    grossTotalPoisha,
    paidPoisha,
    duePoisha: Math.max(0, order.totalPoisha - paidPoisha),
  };
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

/** Merchant template copy (ADV-29 — src/templates/overrides.ts),
 *  fetched resolved from the templates admin API. Nulls = unset:
 *  nothing extra prints, exactly as before overrides existed. */
interface InvoiceTemplateTexts {
  headerNote: string | null;
  footerNote: string | null;
  termsLine: string | null;
}

const NO_TEMPLATE_TEXTS: InvoiceTemplateTexts = { headerNote: null, footerNote: null, termsLine: null };

function InvoiceSheet({
  invoice,
  storeName,
  format,
  template = NO_TEMPLATE_TEXTS,
}: {
  invoice: LoadedInvoice;
  storeName: string;
  format: PrintFormat;
  template?: InvoiceTemplateTexts;
}) {
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const { order, subtotalPoisha, shippingPoisha, discountPoisha, otherPoisha, netAdjustmentPoisha, giftCardNetPoisha, giftCardLast4, grossTotalPoisha, paidPoisha, duePoisha, rentalDepositPoisha, printFeePoisha } = invoice;
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
            <p className="text-small font-semibold uppercase tracking-wide text-text-muted">{s.prInvoice}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-body font-bold">{order.orderNo}</p>
          <p className="text-small text-text-muted">{formatOrderDate(order.createdAt, locale)}</p>
        </div>
      </header>

      {template.headerNote && (
        <p className="mt-3 text-small text-text-muted">{template.headerNote}</p>
      )}

      <div className="mt-4 text-small leading-relaxed">
        <p className="font-semibold">{order.customerName}</p>
        <p>{order.customerPhone}</p>
        <p className="text-text-muted">{addressText(order)}</p>
        <p className="mt-1 text-text-muted">
          {s.prPaymentPrefix}{" "}
          {PAYMENT_METHOD_LABELS[order.paymentMethod]
            ? pick(locale, PAYMENT_METHOD_LABELS[order.paymentMethod])
            : order.paymentMethod}
        </p>
      </div>

      <table className="mt-5 w-full text-left text-small">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-2 font-medium">{s.prodWord}</th>
            <th scope="col" className="py-2 text-center font-medium">{t.quantity}</th>
            <th scope="col" className="py-2 text-right font-medium">{s.prColUnitPrice}</th>
            <th scope="col" className="py-2 text-right font-medium">{t.total}</th>
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
                {formatBdt(lineTotalPoisha(item.unitPricePoisha, item.quantity))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-4 rounded-lg border border-border bg-slate-50/60 px-4 py-3 print:bg-transparent">
        <dl className="space-y-1.5 text-small">
          <div className="flex justify-between">
            <dt className="text-text-muted">{s.prSubtotal}</dt>
            <dd className="tabular-nums">{formatBdt(subtotalPoisha)}</dd>
          </div>
          {shippingPoisha !== null && discountPoisha !== null ? (
            <>
              <div className="flex justify-between">
                <dt className="text-text-muted">{t.deliveryCharge}</dt>
                <dd className="tabular-nums">{formatBdt(shippingPoisha)}</dd>
              </div>
              {discountPoisha > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">{t.discount}</dt>
                  <dd className="tabular-nums">−{formatBdt(discountPoisha)}</dd>
                </div>
              )}
              {rentalDepositPoisha > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">{s.prRentalDeposit}</dt>
                  <dd className="tabular-nums">{formatBdt(rentalDepositPoisha)}</dd>
                </div>
              )}
              {printFeePoisha > 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">{s.prPrintFee}</dt>
                  <dd className="tabular-nums">{formatBdt(printFeePoisha)}</dd>
                </div>
              )}
              {otherPoisha !== 0 && (
                <div className="flex justify-between">
                  <dt className="text-text-muted">{s.prOtherCharges}</dt>
                  <dd className="tabular-nums">{formatBdt(otherPoisha)}</dd>
                </div>
              )}
            </>
          ) : (
            netAdjustmentPoisha !== 0 && (
              <div className="flex justify-between">
                <dt className="text-text-muted">{s.prNetAdjustment}</dt>
                <dd className="tabular-nums">{formatBdt(netAdjustmentPoisha)}</dd>
              </div>
            )
          )}
          {giftCardNetPoisha > 0 && (
            <>
              <div className="flex justify-between border-t border-border pt-2 font-semibold">
                <dt>{s.prGrossBeforeGift}</dt>
                <dd className="tabular-nums">{formatBdt(grossTotalPoisha)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-muted">{interpolate(s.prGiftCard, { last4: giftCardLast4 ?? "????" })}</dt>
                <dd className="tabular-nums">−{formatBdt(giftCardNetPoisha)}</dd>
              </div>
            </>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-body font-bold">
            <dt>{s.prGrandTotal}</dt>
            <dd className="tabular-nums">{formatBdt(order.totalPoisha)}</dd>
          </div>
          {paidPoisha > 0 && (
            <div className="flex justify-between">
              <dt className="text-text-muted">{s.prPaidWord}</dt>
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
              {s.prDueLabel}: {formatBdt(duePoisha)}
            </span>
          </p>
          <p className="mt-1 text-caption text-amber-800">
            {s.prDueNote}
          </p>
        </div>
      ) : (
        <p className="mt-5 flex items-center gap-2 rounded-md bg-emerald-50 px-4 py-3 text-small font-semibold text-emerald-800">
          <Icon name="check" size={16} />
          {s.prPaidFull}
        </p>
      )}

      {(template.termsLine || template.footerNote) && (
        <div className="mt-5 space-y-1 text-caption text-text-muted">
          {template.termsLine && <p>{template.termsLine}</p>}
          {template.footerNote && <p>{template.footerNote}</p>}
        </div>
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
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const { order } = invoice;
  const totalQuantity = order.items.reduce((sum, i) => addQty(sum, i.quantity), 0);
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
            <p className="text-small font-semibold uppercase tracking-wide text-text-muted">{s.prPackingSlip}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-body font-bold">{order.orderNo}</p>
          <p className="text-small text-text-muted">{formatOrderDate(order.createdAt, locale)}</p>
        </div>
      </header>

      <div className="mt-5 leading-relaxed">
        <p className="text-caption font-semibold uppercase tracking-wide text-text-muted">{s.prDeliveryAddress}</p>
        <p className="mt-1 text-h2 font-bold leading-snug">{order.customerName}</p>
        <p className="font-mono text-h3 font-semibold">{order.customerPhone}</p>
        <p className="mt-1 text-body font-medium leading-relaxed">{addressText(order)}</p>
      </div>

      <table className="mt-5 w-full text-left">
        <thead>
          <tr className="border-b border-border text-text-muted">
            <th scope="col" className="py-2 text-small font-medium">{s.prodWord}</th>
            <th scope="col" className="py-2 text-right text-small font-medium">{t.quantity}</th>
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
        {interpolate(s.prTotalItems, { n: totalQuantity })}
      </p>
      <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-caption text-text-muted print:bg-transparent">
        {s.prSlipNoMoney}
      </p>
    </section>
  );
}

function PrintCentreInner() {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const searchParams = useSearchParams();
  const ids = useMemo(() => {
    const raw = searchParams.get("ids") ?? "";
    const unique = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
    return unique.slice(0, MAX_INVOICES);
  }, [searchParams]);

  const [invoices, setInvoices] = useState<LoadedInvoice[] | null>(null);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [storeName, setStoreName] = useState("");
  const [templateTexts, setTemplateTexts] = useState<InvoiceTemplateTexts>(NO_TEMPLATE_TEXTS);
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

      // Merchant invoice template copy (ADV-29): resolved slot
      // texts from the templates API. Same nicety rule as the store
      // name — any failure or a missing settings.view permission
      // just leaves every slot unset and the sheet prints as before.
      try {
        const res = await fetch("/api/v1/admin/settings/templates");
        if (res.ok) {
          const body = (await res.json().catch(() => null)) as
            | { data?: { invoice?: { effective?: Partial<InvoiceTemplateTexts> } } }
            | null;
          const eff = body?.data?.invoice?.effective;
          if (!cancelled && eff) {
            setTemplateTexts({
              headerNote: typeof eff.headerNote === "string" ? eff.headerNote : null,
              footerNote: typeof eff.footerNote === "string" ? eff.footerNote : null,
              termsLine: typeof eff.termsLine === "string" ? eff.termsLine : null,
            });
          }
        }
      } catch {
        /* no template copy */
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
          <h1 className="text-h2">{s.prTitle}</h1>
          <p className="text-small text-text-muted">
            {ids.length === 0
              ? s.prNoneSelected
              : invoices === null
                ? interpolate(s.prLoadingCount, { n: ids.length })
                : interpolate(s.prReadyCount, { n: invoices.length }) +
                  (failedIds.length > 0
                    ? interpolate(s.prFailedCountPart, { n: failedIds.length })
                    : "")}
          </p>
          {invoices !== null && !storeName && (
            <p className="mt-1 text-caption text-text-muted">
              {s.prStoreNameHint}
            </p>
          )}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5" role="group" aria-label={s.prVariantAria}>
            <button type="button" aria-pressed={variant === "invoice"} onClick={() => setVariant("invoice")} className={toggleBtnCls(variant === "invoice")}>
              {s.prInvoiceBtn}
            </button>
            <button type="button" aria-pressed={variant === "slip"} onClick={() => setVariant("slip")} className={toggleBtnCls(variant === "slip")}>
              {s.prSlipBtn}
            </button>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label={s.prFormatAria}>
            <button type="button" aria-pressed={format === "a4"} onClick={() => setFormat("a4")} className={toggleBtnCls(format === "a4")}>
              A4
            </button>
            <button type="button" aria-pressed={format === "thermal"} onClick={() => setFormat("thermal")} className={toggleBtnCls(format === "thermal")}>
              {s.prThermal}
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!invoices || invoices.length === 0}
            className="rounded-md bg-brand-600 px-4 py-2 text-small font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.prPrintAgain}
          </button>
        </div>
      </div>

      {failedIds.length > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-small text-rose-700 print:hidden">
          {interpolate(s.prFailedList, { ids: failedIds.join(", ") })}
        </div>
      )}

      {invoices !== null && invoices.length === 0 && ids.length > 0 && (
        <p className="text-small text-text-muted print:hidden">{s.prNoneCreated}</p>
      )}

      <div id="order-invoice-print">
        {(invoices ?? []).map((invoice) =>
          variant === "invoice" ? (
            <InvoiceSheet key={invoice.order.id} invoice={invoice} storeName={storeName} format={format} template={templateTexts} />
          ) : (
            <PackingSlipSheet key={invoice.order.id} invoice={invoice} storeName={storeName} format={format} />
          ),
        )}
      </div>
    </main>
  );
}

function PrintFallback() {
  const { t } = useLocale();
  return <>{t.loading}</>;
}

export default function OrderPrintPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-3xl p-6 text-small text-text-muted"><PrintFallback /></main>}>
      <PrintCentreInner />
    </Suspense>
  );
}
