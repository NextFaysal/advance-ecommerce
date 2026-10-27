"use client";

// Slide-over order preview (doc 19, batch OD1) — clicking a list row
// opens this drawer with the order's summary, fetched through the
// EXISTING detail endpoint (GET /api/v1/admin/orders/[id]); nothing
// here adds an API or changes one. The phone renders EXACTLY as the
// payload carries it — the route already applies the viewer's mask
// (phoneForViewer), and the preview never widens it (no reveal call).
// Status/money visuals come from the OD0 design-system contract
// (ORDER_STATUS_VISUAL / OrderStatusBadge / MoneyBreakdown) so the
// preview speaks the same language as the list, kanban and detail.
import { useEffect, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { PaymentBadge, type PaymentStatus as UiPaymentStatus } from "@/components/ui/status-badge";
import { formatBdt } from "../../../src/checkout/pricing";
import { lineTotalPoisha } from "../../../src/lib/quantity";
import { ORDER_STATUS_VISUAL } from "../../../src/orders/components/labels";
import { OrderStatusBadge } from "../../../src/orders/components/OrderStatusBadge";
import { MoneyBreakdown } from "../../../src/orders/components/MoneyBreakdown";
import {
  formatOrderDateTime,
  orderAgeLabel,
  previewMoneyProps,
  timelineHead,
  type PreviewOrder,
} from "./list-helpers";
import { interpolate, intlLocale, pick, type Locale } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

const PAYMENT_METHOD_LABEL: Record<string, Record<Locale, string>> = {
  cod: { bn: "ক্যাশ অন ডেলিভারি", en: "Cash on Delivery" },
  bkash: { bn: "বিকাশ", en: "bKash" },
  nagad: { bn: "নগদ", en: "Nagad" },
  rocket: { bn: "রকেট", en: "Rocket" },
  card: { bn: "কার্ড", en: "Card" },
  sslcommerz: { bn: "SSLCommerz", en: "SSLCommerz" },
};

const UI_PAYMENT_STATUSES: readonly string[] = ["UNPAID", "PARTIAL", "PAID", "FAILED", "REFUNDED"];

type DetailResponse =
  | { data: PreviewOrder; meta?: unknown }
  | { error: { code: string; message: string } };

/**
 * Delivery-slot label: Order.deliverySlot stores the slot ID; the
 * bilingual label resolves display-time from the public slots
 * endpoint — the same pattern the detail page uses, with the raw id
 * as the truthful fallback (a renamed/removed slot never shows a
 * wrong label).
 */
function SlotLabel({ slotId }: { slotId: string }) {
  const { locale } = useLocale();
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/delivery-slots")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("slots"))))
      .then((json: { data?: { slots?: { id: string; labelBn: string; labelEn: string }[] } }) => {
        if (cancelled) return;
        const match = json.data?.slots?.find((s) => s.id === slotId);
        if (match) setLabel(locale === "bn" ? match.labelBn : match.labelEn);
      })
      .catch(() => {
        // Raw id fallback below.
      });
    return () => {
      cancelled = true;
    };
  }, [slotId, locale]);
  return <>{label ?? slotId}</>;
}

function PreviewSkeleton() {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  return (
    <div role="status" aria-label={s.ordLoadingAria} className="space-y-4">
      <div className="flex gap-2">
        <div className="h-6 w-24 animate-pulse rounded-full bg-border" />
        <div className="h-6 w-20 animate-pulse rounded-full bg-border" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-40 animate-pulse rounded bg-border" />
        <div className="h-4 w-56 animate-pulse rounded bg-border" />
        <div className="h-4 w-48 animate-pulse rounded bg-border" />
      </div>
      <div className="space-y-2 border-t border-border pt-4">
        <div className="h-4 w-full animate-pulse rounded bg-border" />
        <div className="h-4 w-full animate-pulse rounded bg-border" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-border" />
      </div>
      <p className="text-small text-text-muted">{s.prevLoading}</p>
    </div>
  );
}

export function OrderPreviewDrawer({
  orderId,
  onClose,
}: {
  orderId: string | null;
  onClose: () => void;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [order, setOrder] = useState<PreviewOrder | null>(null);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    setState("loading");
    setOrder(null);
    setError("");
    fetch(`/api/v1/admin/orders/${encodeURIComponent(orderId)}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as DetailResponse | null;
        if (cancelled) return;
        if (res.ok && body && "data" in body && body.data) {
          setOrder(body.data);
          setState("ready");
        } else {
          const message =
            body && "error" in body && body.error
              ? `${body.error.code}: ${body.error.message}`
              : `HTTP ${res.status}`;
          setError(message);
          setState("error");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError(s.networkApi);
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, nonce]);

  const footer =
    state === "ready" && order ? (
      <div className="flex flex-wrap gap-2">
        <a
          href={`/admin/orders/${order.id}`}
          className="flex-1 rounded-md bg-brand-600 px-4 py-2.5 text-center text-small font-semibold text-white shadow-sm transition motion-fast hover:bg-brand-700"
        >
          {s.prevFullDetails}
        </a>
        <a
          href={`/admin/orders/print?ids=${order.id}`}
          target="_blank"
          rel="noreferrer"
          className="flex-1 rounded-md border border-border bg-card px-4 py-2.5 text-center text-small font-semibold text-text-main transition motion-fast hover:border-brand-300 hover:text-brand-700"
        >
          {s.prevPrintInvoice}
        </a>
      </div>
    ) : null;

  return (
    <Drawer
      open={orderId !== null}
      onClose={onClose}
      title={order ? order.orderNo : s.prevTitle}
      footer={footer}
    >
      {state === "loading" ? <PreviewSkeleton /> : null}

      {state === "error" ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4">
          <p className="font-semibold text-rose-700">{s.prevLoadFail}</p>
          <p className="mt-1 text-small text-rose-600">{error}</p>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="mt-3 rounded-md border border-border bg-card px-3.5 py-2 text-small font-semibold text-text-main transition motion-fast hover:border-brand-300 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          >
            {s.tryAgain}
          </button>
        </div>
      ) : null}

      {state === "ready" && order ? (
        <div className="space-y-5">
          {/* Status + age */}
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={order.status} lang={locale} />
            {UI_PAYMENT_STATUSES.includes(order.paymentStatus) ? (
              <PaymentBadge status={order.paymentStatus as UiPaymentStatus} />
            ) : (
              <span className="text-caption font-semibold text-text-muted">{order.paymentStatus}</span>
            )}
            <span className="ml-auto flex items-center gap-1 text-caption text-text-muted">
              <Icon name="clock" size={13} />
              {orderAgeLabel(order.createdAt, Date.now(), locale)} · {formatOrderDateTime(order.createdAt, locale)}
            </span>
          </div>

          {/* Customer block — phone verbatim from the payload (the
           *  route already applied the viewer's mask). */}
          <section aria-label={s.prevCustomerAria}>
            <p className="text-base font-semibold leading-snug">{order.customerName}</p>
            <p className="mt-0.5 font-mono text-small tabular-nums text-text-muted">
              {order.customerPhone}
            </p>
            <p className="mt-1 text-small leading-relaxed text-text-muted">
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
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold text-text-muted">
                <Icon name="credit-card" size={12} />
                {PAYMENT_METHOD_LABEL[order.paymentMethod]
                  ? pick(locale, PAYMENT_METHOD_LABEL[order.paymentMethod])
                  : order.paymentMethod}
              </span>
              {order.deliverySlot ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold text-text-muted">
                  <Icon name="clock" size={12} />
                  <SlotLabel slotId={order.deliverySlot} />
                </span>
              ) : null}
              {order.giftMessage !== null && order.giftMessage !== undefined ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2.5 py-1 text-caption font-semibold text-brand-700">
                  <Icon name="sparkles" size={12} />
                  {s.prevGift}{order.giftMessage ? `: ${order.giftMessage}` : ""}
                </span>
              ) : null}
              {order.courier ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-caption font-semibold text-text-muted">
                  <Icon name="truck" size={12} />
                  {order.courier}
                  {order.trackingId ? ` · ${order.trackingId}` : ""}
                </span>
              ) : null}
            </div>
          </section>

          {/* Items */}
          <section aria-label={s.prevItemsAria} className="border-t border-border pt-4">
            <ul className="space-y-2.5">
              {order.items.map((item) => (
                <li key={item.variantId} className="flex items-start gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">
                    <Icon name="package" size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-small font-medium leading-snug">
                      {item.productName}
                    </span>
                    <span className="block text-caption text-text-subtle">
                      {item.sku} · ×{item.quantity.toLocaleString(intlLocale(locale))}
                    </span>
                  </span>
                  <span className="font-mono text-small font-semibold tabular-nums">
                    {formatBdt(lineTotalPoisha(item.unitPricePoisha, item.quantity))}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Money — OD0 MoneyBreakdown; identical split to print. */}
          <section aria-label={s.prevMoneyAria} className="border-t border-border pt-4">
            <MoneyBreakdown {...previewMoneyProps(order)} lang={locale} />
            {order.advance && order.advance.requiredPoisha > 0 ? (
              <p className="mt-2 text-caption leading-relaxed text-text-muted">
                {interpolate(s.prevAdvance, {
                  required: formatBdt(order.advance.requiredPoisha),
                  paid: formatBdt(order.advance.paidPoisha),
                })}
                {order.advance.requiredPoisha - order.advance.paidPoisha > 0
                  ? interpolate(s.prevAdvanceDue, {
                      due: formatBdt(order.advance.requiredPoisha - order.advance.paidPoisha),
                    })
                  : s.prevAdvanceFull}
              </p>
            ) : null}
          </section>

          {/* Timeline head — newest history entries the payload carries. */}
          <section aria-label={s.prevHistoryAria} className="border-t border-border pt-4">
            <h3 className="text-small font-semibold">{s.prevHistoryTitle}</h3>
            {order.history.length === 0 ? (
              <p className="mt-2 text-small text-text-muted">{s.prevNoHistory}</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {timelineHead(order.history, 4).map((entry, i) => {
                  const visual = ORDER_STATUS_VISUAL[entry.to];
                  return (
                    <li key={`${entry.changedAt}-${i}`} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted">
                        <Icon name={visual.icon} size={13} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-small font-medium leading-snug">
                          {locale === "bn" ? visual.labelBn : visual.labelEn}
                        </span>
                        <span className="block text-caption text-text-subtle">
                          {entry.changedBy} · {formatOrderDateTime(entry.changedAt, locale)}
                        </span>
                        {entry.reason ? (
                          <span className="block text-caption leading-relaxed text-text-muted">
                            {entry.reason}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
