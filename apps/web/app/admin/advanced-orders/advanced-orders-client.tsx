"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTableSkeleton } from "@/components/ui/table";
import { Phone } from "@/components/ui/phone";
import {
  computeExchange, derivePaymentStatus, duePoisha, preOrderDuePoisha,
  type AllocationResult, type DerivedPaymentStatus, type PartialPaymentState,
  type PreOrder, type PreOrderStatus, type StockTransfer, type TransferStatus,
  type WarehouseStock,
} from "@/advanced-orders";
import type { OrderItem } from "@/orders/types";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick, type Locale } from "@/i18n/locale";
import { ADVANCED_ORDERS_STRINGS, type AdvancedOrdersStrings } from "./strings";

/**
 * Advanced Orders panels — wired to the real API by W0-D (doc 21
 * G3-7). Agent 43's original ran every panel over SAMPLE data in
 * client state while a DB-backed API sat unused; nothing on this
 * page is sample data any more:
 *
 *  - Pre-orders + stock transfers: GET /api/v1/admin/advanced-orders
 *    (PrismaAdvancedOrderStore, meta.persistence "database").
 *  - Split planner: the selected REAL order's lines + REAL
 *    per-warehouse availability (GET /api/v1/admin/inventory) POSTed
 *    to /api/v1/admin/advanced-orders — a pure preview endpoint that
 *    answers persisted:false; the panel says so. Real shipments are
 *    created from the order workspace, not here.
 *  - Payment panel: the selected order's REAL totals — order detail
 *    (GET /api/v1/admin/orders/[id]) + the refund workbench summary
 *    (GET .../refunds) — read through the same derivePaymentStatus /
 *    duePoisha functions. Recording money stays where the real
 *    endpoints live (order workspace refunds, Payments > manual Trx);
 *    this panel deliberately has no pay/refund buttons.
 *  - Exchange calculator: computeExchange over a real order line's
 *    snapshot price vs a real catalog variant. Actual exchanges are
 *    executed from the order's returns panel; this is the arithmetic.
 *  - Order merge: NO backend exists anywhere (doc 21 §4) — the old
 *    demo panel is replaced by an honest note. Nothing fake-persists.
 *  - Pre-order fulfilment: POST /api/v1/admin/preorders/[id]/fulfil
 *    creates the actual order server-side (deposit credited). The old
 *    client-state "১টি সরবরাহ" partial button is gone — partial
 *    fulfilment quantity has no persisted column and no endpoint, so
 *    it could only ever pretend.
 */

const selectClass =
  "h-10 w-full rounded-xl border border-border bg-card px-3 text-sm outline-none transition duration-fast ease-smooth focus:border-brand-500";

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "neutral";
const PAYMENT_STATUS_KEY: Record<DerivedPaymentStatus, keyof AdvancedOrdersStrings> = {
  UNPAID: "payUnpaid", PARTIAL: "payPartial", PAID: "payPaid", REFUNDED: "payRefunded", PARTIALLY_REFUNDED: "payPartiallyRefunded",
};
const PREORDER_STATUS_META: Record<PreOrderStatus, { labelKey: keyof AdvancedOrdersStrings; tone: Tone }> = {
  OPEN: { labelKey: "preOpen", tone: "info" },
  PARTIALLY_FULFILLED: { labelKey: "prePartial", tone: "warning" },
  FULFILLED: { labelKey: "preFulfilled", tone: "success" },
  CANCELLED: { labelKey: "preCancelled", tone: "danger" },
};
const TRANSFER_STATUS_META: Record<TransferStatus, { labelKey: keyof AdvancedOrdersStrings; tone: Tone }> = {
  DRAFT: { labelKey: "trDraft", tone: "neutral" },
  IN_TRANSIT: { labelKey: "trInTransit", tone: "info" },
  RECEIVED: { labelKey: "trReceived", tone: "success" },
  CANCELLED: { labelKey: "trCancelled", tone: "danger" },
};
function useStrings(): AdvancedOrdersStrings & { locale: Locale } {
  const { locale } = useLocale();
  return { ...pick(locale, ADVANCED_ORDERS_STRINGS), locale };
}

interface OrderRow {
  id: string;
  orderNo: string;
  status: string;
  totalPoisha: number;
  customerPhone: string;
}

interface OrderDetailItem {
  variantId: string;
  sku: string;
  productName: string;
  unitPricePoisha: number;
  quantity: number;
}

interface OrderDetail extends OrderRow {
  items: OrderDetailItem[];
  advance?: { paidPoisha: number } | null;
}

interface InventoryRow {
  variantId: string;
  warehouseId: string;
  quantityAvailable: number;
}

interface ProductVariantHit {
  id: string;
  sku: string;
  pricePoisha: number;
  stock: number;
  isActive: boolean;
}

interface ProductHit {
  id: string;
  title: { bn: string; en: string };
  variants: ProductVariantHit[];
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const body = (await res.json().catch(() => null)) as { data?: T; error?: { message?: string } } | null;
  if (!res.ok || body?.data === undefined) {
    throw new Error(body?.error?.message ?? `GET ${url} failed (${res.status})`);
  }
  return body.data;
}

function PanelMessage({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p
      role="status"
      className={`mt-3 rounded-xl px-3 py-2 text-sm ${
        ok ? "bg-success-soft text-success-solid" : "bg-danger-soft text-danger"
      }`}
    >
      {text}
    </p>
  );
}

function useOrderDetail(orderId: string | null) {
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orderId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
    getJson<OrderDetail>(`/api/v1/admin/orders/${orderId}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);
  return { detail, error };
}

function OrderPicker({
  orders, value, onChange, label,
}: {
  orders: OrderRow[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const t = useStrings();
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.orderNo} — {o.status}, {t.pickerTotal} {formatPoisha(o.totalPoisha)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- Split planner ---------------------------------------------------------

function SplitPlanner({ orders, inventory }: { orders: OrderRow[]; inventory: InventoryRow[] }) {
  const t = useStrings();
  const [orderId, setOrderId] = useState("");
  const selectedId = orderId || orders[0]?.id || null;
  const { detail, error: detailError } = useOrderDetail(selectedId);
  const [result, setResult] = useState<AllocationResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);

  // Real per-warehouse availability from the inventory ledger rows.
  // No warehouse-name source exists in any API (the inventory page
  // shows the id too), so the id doubles as the display name.
  const warehouses = useMemo<WarehouseStock[]>(() => {
    const byWarehouse = new Map<string, Record<string, number>>();
    for (const row of inventory) {
      const entry = byWarehouse.get(row.warehouseId) ?? {};
      entry[row.variantId] = row.quantityAvailable;
      byWarehouse.set(row.warehouseId, entry);
    }
    return [...byWarehouse.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([warehouseId, availableByVariant], i) => ({
        warehouseId,
        warehouseName: warehouseId,
        priority: i + 1,
        availableByVariant,
      }));
  }, [inventory]);

  const runPlan = useCallback(async () => {
    if (!detail || warehouses.length === 0) return;
    setPlanning(true);
    setPlanError(null);
    try {
      const res = await fetch("/api/v1/admin/advanced-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: detail.items, warehouses }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { allocation: AllocationResult }; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.data) {
        throw new Error(body?.error?.message ?? `${t.planFailed} (${res.status})`);
      }
      setResult(body.data.allocation);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : t.planFailedGeneric);
      setResult(null);
    } finally {
      setPlanning(false);
    }
  }, [detail, warehouses]);

  useEffect(() => {
    setResult(null);
    if (detail && warehouses.length > 0) void runPlan();
  }, [detail, warehouses, runPlan]);

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.splitTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t.splitDesc1}{" "}
        <code>allocateOrderItems()</code> {t.splitDesc2} <code>persisted: false</code> {t.splitDesc3}
      </p>
      {orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t.noOrdersPlannerEmptyTitle} description={t.noOrdersPlannerEmptyDesc} />
        </div>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={setOrderId} label={t.realOrder} />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">{t.orderLoading}</p> : null}
          {detail && warehouses.length === 0 ? (
            <p className="mt-3 text-sm text-warning-solid">{t.noWarehouseStock}</p>
          ) : null}
          {planning ? <p className="mt-3 text-sm text-text-muted">{t.planning}</p> : null}
          {planError ? <PanelMessage ok={false} text={planError} /> : null}
          {result ? (
            <>
              <div className="mt-4 space-y-4">
                {result.shipments.map((s) => (
                  <div key={s.shipmentKey} className="rounded-xl border border-border/60 bg-surface-2/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{s.shipmentKey} · {s.warehouseName}</p>
                      <span className="text-sm">{t.subtotal} <Money poisha={s.subtotalPoisha} /></span>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {s.lines.map((l) => (
                        <li key={l.variantId} className="flex justify-between gap-2">
                          <span>{l.productName} <span className="text-text-muted">({l.sku})</span></span>
                          <span className="tnum">{l.quantity}{t.qtySuffix} × <Money poisha={l.unitPricePoisha} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {result.unallocated.length > 0 ? (
                <div className="mt-4 rounded-xl border border-warning-solid/30 bg-warning-soft p-3">
                  <p className="font-medium text-text-main">
                    {t.backorderTitle} ({result.unallocated.reduce((s, l) => s + l.quantity, 0)}{t.qtySuffix})
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-text-main">
                    {result.unallocated.map((l) => (
                      <li key={l.variantId} className="flex justify-between gap-2">
                        <span>{l.productName} <span>({l.sku})</span></span>
                        <span className="tnum">{t.shortage} {l.quantity}{t.qtySuffix}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-success-solid">{t.allAllocated}</p>
              )}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ---- Partial payment state (read-only, real figures) ------------------------

function PaymentPanel({ orders }: { orders: OrderRow[] }) {
  const t = useStrings();
  const [orderId, setOrderId] = useState("");
  const selectedId = orderId || orders[0]?.id || null;
  const { detail, error: detailError } = useOrderDetail(selectedId);
  const [summary, setSummary] = useState<{ grossPaidPoisha: number; refundedPoisha: number } | null>(null);
  const [summaryFailed, setSummaryFailed] = useState(false);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setSummary(null);
    setSummaryFailed(false);
    getJson<{ summary: { grossPaidPoisha: number; refundedPoisha: number } }>(
      `/api/v1/admin/orders/${selectedId}/refunds`,
    )
      .then((d) => {
        if (!cancelled) setSummary(d.summary);
      })
      .catch(() => {
        // The refunds route needs payments.view; without it the panel
        // falls back to the order detail's advance paid figure and
        // says the refund total is unavailable — never invents one.
        if (!cancelled) setSummaryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const state: PartialPaymentState | null = detail
    ? {
        totalPoisha: detail.totalPoisha,
        paidPoisha: summary ? summary.grossPaidPoisha : (detail.advance?.paidPoisha ?? 0),
        refundedPoisha: summary ? summary.refundedPoisha : 0,
      }
    : null;
  const status = state ? derivePaymentStatus(state) : null;

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.paymentTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t.paymentDesc1} <code>derivePaymentStatus()</code> {t.paymentDesc2}
      </p>
      {orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t.noOrdersEmptyTitle} description={t.noOrdersEmptyDesc} />
        </div>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={setOrderId} label={t.realOrder} />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">{t.orderLoading}</p> : null}
          {state && status ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-text-muted">{t.orderTotal}</dt><dd><Money poisha={state.totalPoisha} /></dd></div>
                <div><dt className="text-text-muted">{t.paidAmount}</dt><dd><Money poisha={state.paidPoisha} /></dd></div>
                <div>
                  <dt className="text-text-muted">{t.refundedAmount}</dt>
                  <dd>{summary ? <Money poisha={state.refundedPoisha} /> : "—"}</dd>
                </div>
                <div><dt className="text-text-muted">{t.due}</dt><dd><Money poisha={duePoisha(state)} /></dd></div>
              </dl>
              {summaryFailed ? (
                <p className="mt-2 text-xs text-text-muted">{t.refundSummaryFailed}</p>
              ) : null}
              <p className="mt-3">
                {t.statusLabel}: <Badge tone={status === "PAID" ? "success" : status === "UNPAID" ? "danger" : "warning"}>
                  {t[PAYMENT_STATUS_KEY[status]]} ({status})
                </Badge>
              </p>
              {selectedId ? (
                <p className="mt-4 text-sm">
                  <Link href={`/admin/orders/${selectedId}`} className="text-brand-600 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300">
                    {t.openWorkspace}
                  </Link>
                </p>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ---- Exchange calculator -----------------------------------------------------

interface ReplacementOption {
  variantId: string;
  label: string;
  item: OrderItem;
}

function ExchangePanel({ orders, products }: { orders: OrderRow[]; products: ProductHit[] }) {
  const t = useStrings();
  const [orderId, setOrderId] = useState("");
  const selectedId = orderId || orders[0]?.id || null;
  const { detail, error: detailError } = useOrderDetail(selectedId);
  const [returnedVariantId, setReturnedVariantId] = useState("");
  const [replacementVariantId, setReplacementVariantId] = useState("");
  const [returnedQty, setReturnedQty] = useState("1");
  const [replacementQty, setReplacementQty] = useState("1");

  const replacements = useMemo<ReplacementOption[]>(
    () =>
      products.flatMap((p) =>
        (p.variants ?? [])
          .filter((v) => v.isActive)
          .map((v) => ({
            variantId: v.id,
            label: `${p.title[t.locale]} — ${v.sku} — ${formatPoisha(v.pricePoisha)}`,
            item: {
              variantId: v.id,
              productName: p.title[t.locale],
              sku: v.sku,
              unitPricePoisha: v.pricePoisha,
              quantity: 1,
            },
          })),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, t.locale],
  );

  const returnedItem = detail?.items.find((i) => i.variantId === returnedVariantId) ?? detail?.items[0] ?? null;
  const replacement = replacements.find((r) => r.variantId === replacementVariantId) ?? replacements[0] ?? null;
  const result =
    returnedItem && replacement
      ? computeExchange({
          orderId: detail?.id ?? "",
          returnedItem,
          returnedQty: Math.max(0, Math.trunc(Number(returnedQty) || 0)),
          replacementItem: replacement.item,
          replacementQty: Math.max(0, Math.trunc(Number(replacementQty) || 0)),
        })
      : null;
  const directionLabel = !result
    ? ""
    : result.direction === "CUSTOMER_OWES"
      ? t.dirCustomerOwes
      : result.direction === "STORE_REFUNDS"
        ? t.dirStoreRefunds
        : t.dirEven;

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.exchangeTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t.exchangeDesc1} <code>computeExchange()</code> {t.exchangeDesc2}
      </p>
      {orders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t.noOrdersEmptyTitle} description={t.noOrdersEmptyDesc} />
        </div>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={(id) => { setOrderId(id); setReturnedVariantId(""); }} label={t.returnOrder} />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">{t.orderLoading}</p> : null}
          {detail && returnedItem ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">{t.returningLabel}</span>
                  <select
                    className={selectClass}
                    value={returnedItem.variantId}
                    onChange={(e) => setReturnedVariantId(e.target.value)}
                  >
                    {detail.items.map((i) => (
                      <option key={i.variantId} value={i.variantId}>
                        {i.productName} ({i.sku}) — {formatPoisha(i.unitPricePoisha)} × {i.quantity}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">{t.replacementLabel}</span>
                  <select
                    className={selectClass}
                    value={replacement?.variantId ?? ""}
                    onChange={(e) => setReplacementVariantId(e.target.value)}
                  >
                    {replacements.map((r) => (
                      <option key={r.variantId} value={r.variantId}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <Input label={t.returnedQty} name="returned-qty" type="number" min="0" value={returnedQty} onChange={(e) => setReturnedQty(e.target.value)} />
                <Input label={t.replacementQty} name="replacement-qty" type="number" min="0" value={replacementQty} onChange={(e) => setReplacementQty(e.target.value)} />
              </div>
              {result ? (
                <>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-text-muted">{t.returnedValue}</dt><dd><Money poisha={result.returnedValuePoisha} /></dd></div>
                    <div><dt className="text-text-muted">{t.replacementValue}</dt><dd><Money poisha={result.replacementValuePoisha} /></dd></div>
                    <div>
                      <dt className="text-text-muted">{t.difference}</dt>
                      <dd><Money poisha={result.differencePoisha} /></dd>
                    </div>
                  </dl>
                  <p className="mt-3">
                    <Badge tone={result.direction === "EVEN" ? "neutral" : result.direction === "CUSTOMER_OWES" ? "warning" : "info"}>
                      {directionLabel}
                    </Badge>
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-text-muted">{t.noActiveVariant}</p>
              )}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
}

// ---- Merge: no backend exists — honest note, no fake action -------------------

function MergeNote() {
  const t = useStrings();
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.mergeTitle}</h2>
      <p className="mt-2 text-sm text-text-muted">
        <strong>{t.mergeBody1}</strong> {t.mergeBody2}{" "}
        <code>validateOrderMerge()</code> {t.mergeBody3}
      </p>
    </Card>
  );
}

// ---- Pre-orders ----------------------------------------------------------------

function PreOrderPanel({ preOrders, onChanged }: { preOrders: PreOrder[]; onChanged: () => void }) {
  const t = useStrings();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Real fulfilment — doc 17 O9-1: POSTs to /api/v1/admin/preorders/[id]/fulfil,
  // which creates the actual Order (deposit credited) server-side and
  // marks this row FULFILLED. ADDRESS_REQUIRED (no address on file for
  // the customer) prompts staff for one and retries — never invented.
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const fulfilToOrder = async (pre: PreOrder) => {
    setFulfillingId(pre.id);
    setMessage(null);
    try {
      const post = async (body: Record<string, unknown>) => {
        const res = await fetch(`/api/v1/admin/preorders/${pre.id}/fulfil`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        return (await res.json().catch(() => ({}))) as {
          data?: { orderNo?: string; payablePoisha?: number };
          meta?: { alreadyConverted?: boolean };
          error?: { code?: string; message?: string };
        };
      };
      let result = await post({});
      if (result.error?.code === "ADDRESS_REQUIRED") {
        const division = window.prompt(t.promptDivision, "Dhaka");
        const district = window.prompt(t.promptDistrict, "Dhaka");
        const upazila = window.prompt(t.promptUpazila, "");
        const addressLine = window.prompt(t.promptAddress, "");
        if (!division || !district || !upazila || !addressLine) {
          setMessage({ ok: false, text: `${pre.sku || pre.id}: ${t.fulfilCancelledNoAddress}` });
          return;
        }
        result = await post({ address: { division, district, upazila, addressLine } });
      }
      if (result.error) {
        setMessage({ ok: false, text: `${pre.sku || pre.id}: ${result.error.message ?? result.error.code ?? t.fulfilFailed}` });
        return;
      }
      setMessage({
        ok: true,
        text: `${pre.sku || pre.id}: ${t.fulfilCreated} — ${result.data?.orderNo ?? ""}${result.meta?.alreadyConverted ? ` ${t.fulfilAlready}` : ""}; ${t.fulfilPayable} ${formatPoisha(result.data?.payablePoisha ?? 0)}।`,
      });
      onChanged();
    } catch {
      setMessage({ ok: false, text: `${pre.sku || pre.id}: ${t.fulfilNetwork}` });
    } finally {
      setFulfillingId(null);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.preorderTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t.preorderDesc1}{" "}
        <code>preOrderDuePoisha()</code> {t.preorderDesc2}
      </p>
      {preOrders.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t.noPreordersEmptyTitle} description={t.noPreordersEmptyDesc} />
        </div>
      ) : (
        <>
        <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/80">
              <tr>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colSku}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colCustomer}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colQty}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colTotal}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colDeposit}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colDue}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colFulfilled}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colExpected}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colStatus}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colAction}</th>
              </tr>
            </thead>
            <tbody>
              {preOrders.map((pre) => {
                const total = pre.unitPricePoisha * pre.quantity;
                const statusMeta = PREORDER_STATUS_META[pre.status];
                return (
                  <tr key={pre.id} className="border-t border-border/60 transition duration-fast ease-smooth hover:bg-brand-soft/60">
                    <td className="px-4 py-3 font-mono">{pre.sku || pre.productVariantId}</td>
                    <td className="px-4 py-3"><Phone phone={pre.customerPhone} /></td>
                    <td className="tnum px-4 py-3">{pre.quantity}{t.qtySuffix}</td>
                    <td className="px-4 py-3"><Money poisha={total} /></td>
                    <td className="px-4 py-3"><Money poisha={pre.depositPoisha} /></td>
                    <td className="px-4 py-3"><Money poisha={preOrderDuePoisha(pre)} /></td>
                    <td className="tnum px-4 py-3">{pre.fulfilledQty}/{pre.quantity}</td>
                    <td className="px-4 py-3">{pre.expectedDate}</td>
                    <td className="px-4 py-3"><Badge tone={statusMeta.tone}>{t[statusMeta.labelKey]}</Badge></td>
                    <td className="px-4 py-3">
                      {pre.status !== "FULFILLED" && pre.status !== "CANCELLED" && pre.depositPoisha > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={fulfillingId === pre.id}
                          onClick={() => fulfilToOrder(pre)}
                        >
                          {fulfillingId === pre.id ? t.creating : t.createRealOrder}
                        </Button>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Mobile card view (doc 31 D4) — same rows, same fulfil action. */}
        <ul className="mt-4 space-y-3 md:hidden">
          {preOrders.map((pre) => {
            const total = pre.unitPricePoisha * pre.quantity;
            const statusMeta = PREORDER_STATUS_META[pre.status];
            return (
              <li key={pre.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-text-main">{pre.sku || pre.productVariantId}</span>
                  <Badge tone={statusMeta.tone}>{t[statusMeta.labelKey]}</Badge>
                </div>
                <p className="mt-2 text-sm text-text-muted"><Phone phone={pre.customerPhone} /></p>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-xs text-text-muted">{t.colTotal}</dt><dd><Money poisha={total} /></dd></div>
                  <div><dt className="text-xs text-text-muted">{t.colDeposit}</dt><dd><Money poisha={pre.depositPoisha} /></dd></div>
                  <div><dt className="text-xs text-text-muted">{t.colDue}</dt><dd><Money poisha={preOrderDuePoisha(pre)} /></dd></div>
                </dl>
                <p className="tnum mt-2 text-xs text-text-muted">
                  {t.colQty} {pre.quantity}{t.qtySuffix} · {t.colFulfilled} {pre.fulfilledQty}/{pre.quantity} · {pre.expectedDate}
                </p>
                {pre.status !== "FULFILLED" && pre.status !== "CANCELLED" && pre.depositPoisha > 0 ? (
                  <div className="mt-3">
                    <Button
                      type="button"
                      size="sm"
                      disabled={fulfillingId === pre.id}
                      onClick={() => fulfilToOrder(pre)}
                    >
                      {fulfillingId === pre.id ? t.creating : t.createRealOrder}
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        </>
      )}
      {message ? <PanelMessage ok={message.ok} text={message.text} /> : null}
    </Card>
  );
}

// ---- Stock transfers (read-only, real rows) -------------------------------------

function TransfersCard({ transfers }: { transfers: StockTransfer[] }) {
  const t = useStrings();
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-text-main">{t.transfersTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">{t.transfersDesc}</p>
      {transfers.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t.noTransfersEmptyTitle} description={t.noTransfersEmptyDesc} />
        </div>
      ) : (
        <>
        <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-2/80">
              <tr>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colFromTo}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colLines}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colCreated}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colDispatched}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colReceived}</th>
                <th className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{t.colStatus}</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((tr) => {
                const meta = TRANSFER_STATUS_META[tr.status];
                return (
                  <tr key={tr.id} className="border-t border-border/60 transition duration-fast ease-smooth hover:bg-brand-soft/60">
                    <td className="px-4 py-3 font-mono">{tr.fromWarehouseId} → {tr.toWarehouseId}</td>
                    <td className="px-4 py-3">
                      {tr.lines.map((l) => `${l.sku} × ${l.quantity}`).join(", ") || "—"}
                    </td>
                    <td className="tnum px-4 py-3">{tr.createdAt.slice(0, 10)}</td>
                    <td className="tnum px-4 py-3">{tr.dispatchedAt ? tr.dispatchedAt.slice(0, 10) : "—"}</td>
                    <td className="tnum px-4 py-3">{tr.receivedAt ? tr.receivedAt.slice(0, 10) : "—"}</td>
                    <td className="px-4 py-3"><Badge tone={meta.tone}>{t[meta.labelKey]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Mobile card view (doc 31 D4) — same rows, read-only like the table. */}
        <ul className="mt-4 space-y-3 md:hidden">
          {transfers.map((tr) => {
            const meta = TRANSFER_STATUS_META[tr.status];
            return (
              <li key={tr.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-text-main">{tr.fromWarehouseId} → {tr.toWarehouseId}</span>
                  <Badge tone={meta.tone}>{t[meta.labelKey]}</Badge>
                </div>
                <p className="mt-2 text-sm text-text-muted">
                  {tr.lines.map((l) => `${l.sku} × ${l.quantity}`).join(", ") || "—"}
                </p>
                <p className="tnum mt-2 text-xs text-text-muted">
                  {t.colCreated} {tr.createdAt.slice(0, 10)} · {t.colDispatched} {tr.dispatchedAt ? tr.dispatchedAt.slice(0, 10) : "—"} · {t.colReceived} {tr.receivedAt ? tr.receivedAt.slice(0, 10) : "—"}
                </p>
              </li>
            );
          })}
        </ul>
        </>
      )}
    </Card>
  );
}

// ---- Page body -------------------------------------------------------------------

export function AdvancedOrdersClient() {
  const t = useStrings();
  const [preOrders, setPreOrders] = useState<PreOrder[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(true);
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);

  const loadAdvanced = useCallback(async () => {
    const data = await getJson<{ preOrders: PreOrder[]; transfers: StockTransfer[] }>(
      "/api/v1/admin/advanced-orders",
    );
    setPreOrders(data.preOrders ?? []);
    setTransfers(data.transfers ?? []);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const failed: string[] = [];
    const attempt = async <T,>(name: string, run: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await run();
      } catch {
        failed.push(name);
        return fallback;
      }
    };
    await attempt(t.feedPreorders, () => loadAdvanced(), undefined);
    setOrders(
      await attempt(t.feedOrders, () => getJson<OrderRow[]>("/api/v1/admin/orders?page=1&pageSize=50"), []),
    );
    setInventory(
      await attempt(
        t.feedInventory,
        async () => (await getJson<{ items: InventoryRow[] }>("/api/v1/admin/inventory")).items ?? [],
        [],
      ),
    );
    setProducts(
      await attempt(
        t.feedCatalog,
        () => getJson<ProductHit[]>("/api/v1/admin/products?status=ALL&page=1&pageSize=50"),
        [],
      ),
    );
    setFailedFeeds(failed);
    setLoading(false);
  }, [loadAdvanced]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  if (loading) {
    return (
      <div className="space-y-6">
        <p className="sr-only">{t.loadingReal}</p>
        <DataTableSkeleton columns={5} rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {failedFeeds.length > 0 ? (
        <div className="rounded-2xl border border-warning-solid/30 bg-warning-soft px-4 py-3 text-sm text-text-main">
          <strong>{t.feedsFailedPrefix}</strong> {failedFeeds.join(", ")}{t.feedsFailedSuffix}{" "}
          <button type="button" className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300" onClick={() => void loadAll()}>
            {t.retry}
          </button>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2">
        <SplitPlanner orders={orders} inventory={inventory} />
        <PaymentPanel orders={orders} />
        <ExchangePanel orders={orders} products={products} />
        <MergeNote />
      </div>
      <PreOrderPanel preOrders={preOrders} onChanged={() => void loadAdvanced().catch(() => undefined)} />
      <TransfersCard transfers={transfers} />
    </div>
  );
}
