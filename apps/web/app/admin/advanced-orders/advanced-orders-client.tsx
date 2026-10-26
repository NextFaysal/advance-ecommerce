"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import {
  computeExchange, derivePaymentStatus, duePoisha, preOrderDuePoisha,
  type AllocationResult, type DerivedPaymentStatus, type PartialPaymentState,
  type PreOrder, type PreOrderStatus, type StockTransfer, type TransferStatus,
  type WarehouseStock,
} from "@/advanced-orders";
import type { OrderItem } from "@/orders/types";

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
  "h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500";

const PAYMENT_STATUS_BN: Record<DerivedPaymentStatus, string> = {
  UNPAID: "পরিশোধ হয়নি",
  PARTIAL: "আংশিক পরিশোধ",
  PAID: "সম্পূর্ণ পরিশোধিত",
  REFUNDED: "সম্পূর্ণ ফেরত",
  PARTIALLY_REFUNDED: "আংশিক ফেরত",
};

const PREORDER_STATUS_BN: Record<PreOrderStatus, { label: string; tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral" }> = {
  OPEN: { label: "চলমান", tone: "info" },
  PARTIALLY_FULFILLED: { label: "আংশিক সরবরাহ", tone: "warning" },
  FULFILLED: { label: "সম্পূর্ণ সরবরাহ", tone: "success" },
  CANCELLED: { label: "বাতিল", tone: "danger" },
};

const TRANSFER_STATUS_BN: Record<TransferStatus, { label: string; tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral" }> = {
  DRAFT: { label: "খসড়া", tone: "neutral" },
  IN_TRANSIT: { label: "পথে আছে", tone: "info" },
  RECEIVED: { label: "পৌঁছেছে", tone: "success" },
  CANCELLED: { label: "বাতিল", tone: "danger" },
};

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
      className={`mt-3 rounded-md px-3 py-2 text-sm ${
        ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"
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
  return (
    <label className="mt-4 block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            {o.orderNo} — {o.status}, মোট {formatPoisha(o.totalPoisha)}
          </option>
        ))}
      </select>
    </label>
  );
}

// ---- Split planner ---------------------------------------------------------

function SplitPlanner({ orders, inventory }: { orders: OrderRow[]; inventory: InventoryRow[] }) {
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
        throw new Error(body?.error?.message ?? `প্ল্যান তৈরি ব্যর্থ (${res.status})`);
      }
      setResult(body.data.allocation);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : "প্ল্যান তৈরি ব্যর্থ হয়েছে।");
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
      <h2 className="text-lg font-semibold">স্প্লিট শিপমেন্ট প্ল্যানার</h2>
      <p className="mt-1 text-sm text-text-muted">
        আসল অর্ডারের লাইন ও ইনভেন্টরির আসল গুদাম-স্টক সার্ভারের{" "}
        <code>allocateOrderItems()</code> দিয়ে ভাগ করা হয় (POST /api/v1/admin/advanced-orders)।
        এটি শুধু একটি প্ল্যান/পূর্বরূপ — API নিজেই <code>persisted: false</code> ফেরত দেয়;
        আসল শিপমেন্ট তৈরি হয় অর্ডার ওয়ার্কস্পেস থেকে। যেটুকু কোনো গুদামেই নেই তা
        ব্যাকঅর্ডার হিসেবে আলাদা দেখানো হয় — কখনো লুকানো হয় না।
      </p>
      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">কোনো অর্ডার পাওয়া যায়নি — প্ল্যানার চালানোর মতো অর্ডার নেই।</p>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={setOrderId} label="আসল অর্ডার" />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">অর্ডার লোড হচ্ছে…</p> : null}
          {detail && warehouses.length === 0 ? (
            <p className="mt-3 text-sm text-amber-800">
              ইনভেন্টরিতে কোনো গুদাম-স্টক রো নেই — প্ল্যান তৈরি করা যাচ্ছে না।
            </p>
          ) : null}
          {planning ? <p className="mt-3 text-sm text-text-muted">প্ল্যান তৈরি হচ্ছে…</p> : null}
          {planError ? <PanelMessage ok={false} text={planError} /> : null}
          {result ? (
            <>
              <div className="mt-4 space-y-4">
                {result.shipments.map((s) => (
                  <div key={s.shipmentKey} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{s.shipmentKey} · {s.warehouseName}</p>
                      <span className="text-sm">সাবটোটাল <Money poisha={s.subtotalPoisha} /></span>
                    </div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {s.lines.map((l) => (
                        <li key={l.variantId} className="flex justify-between gap-2">
                          <span>{l.productName} <span className="text-text-muted">({l.sku})</span></span>
                          <span>{l.quantity}টি × <Money poisha={l.unitPricePoisha} /></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              {result.unallocated.length > 0 ? (
                <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <p className="font-medium text-amber-900">
                    ব্যাকঅর্ডার প্রার্থী — কোনো গুদামেই স্টক নেই ({result.unallocated.reduce((s, l) => s + l.quantity, 0)}টি)
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-amber-900">
                    {result.unallocated.map((l) => (
                      <li key={l.variantId} className="flex justify-between gap-2">
                        <span>{l.productName} <span>({l.sku})</span></span>
                        <span>ঘাটতি {l.quantity}টি</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 text-sm text-emerald-700">সব আইটেম বরাদ্দ হয়েছে — ব্যাকঅর্ডার নেই।</p>
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
      <h2 className="text-lg font-semibold">আংশিক পেমেন্ট ও রিফান্ড — অবস্থা</h2>
      <p className="mt-1 text-sm text-text-muted">
        আসল অর্ডারের আসল হিসাব: মোট অর্ডার ডিটেইল থেকে, পরিশোধ ও রিফান্ড রিফান্ড
        ওয়ার্কবেঞ্চের সামারি থেকে — অবস্থা আসল <code>derivePaymentStatus()</code> দিয়ে।
        পেমেন্ট রেকর্ড ও রিফান্ড এই প্যানেল থেকে হয় না: রিফান্ড হয় অর্ডার ওয়ার্কস্পেসের
        রিফান্ড প্যানেল থেকে, ম্যানুয়াল Trx যাচাই হয় Payments পেজ থেকে।
      </p>
      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">কোনো অর্ডার পাওয়া যায়নি।</p>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={setOrderId} label="আসল অর্ডার" />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">অর্ডার লোড হচ্ছে…</p> : null}
          {state && status ? (
            <>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-text-muted">অর্ডার মোট</dt><dd><Money poisha={state.totalPoisha} /></dd></div>
                <div><dt className="text-text-muted">পরিশোধ হয়েছে</dt><dd><Money poisha={state.paidPoisha} /></dd></div>
                <div>
                  <dt className="text-text-muted">রিফান্ড হয়েছে (অর্থ পৌঁছেছে)</dt>
                  <dd>{summary ? <Money poisha={state.refundedPoisha} /> : "—"}</dd>
                </div>
                <div><dt className="text-text-muted">বাকি (due)</dt><dd><Money poisha={duePoisha(state)} /></dd></div>
              </dl>
              {summaryFailed ? (
                <p className="mt-2 text-xs text-text-muted">
                  রিফান্ড সামারি পড়া যায়নি (payments.view অনুমতি লাগে) — পরিশোধের অঙ্ক অর্ডারের
                  অগ্রিম হিসাব থেকে দেখানো হচ্ছে, রিফান্ডের অঙ্ক দেখানো হচ্ছে না।
                </p>
              ) : null}
              <p className="mt-3">
                অবস্থা: <Badge tone={status === "PAID" ? "success" : status === "UNPAID" ? "danger" : "warning"}>
                  {PAYMENT_STATUS_BN[status]} ({status})
                </Badge>
              </p>
              {selectedId ? (
                <p className="mt-4 text-sm">
                  <Link href={`/admin/orders/${selectedId}`} className="text-brand-600 underline">
                    এই অর্ডারের ওয়ার্কস্পেস খুলুন — রিফান্ড ও পেমেন্ট সেখানেই রেকর্ড হয় →
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
            label: `${p.title.bn} — ${v.sku} — ${formatPoisha(v.pricePoisha)}`,
            item: {
              variantId: v.id,
              productName: p.title.bn,
              sku: v.sku,
              unitPricePoisha: v.pricePoisha,
              quantity: 1,
            },
          })),
      ),
    [products],
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
  const directionBn = !result
    ? ""
    : result.direction === "CUSTOMER_OWES"
      ? "গ্রাহক পার্থক্য পরিশোধ করবেন"
      : result.direction === "STORE_REFUNDS"
        ? "দোকান পার্থক্য ফেরত দেবে"
        : "সমান বিনিময় — কোনো পার্থক্য নেই";

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">এক্সচেঞ্জ ক্যালকুলেটর</h2>
      <p className="mt-1 text-sm text-text-muted">
        ফেরতের আইটেম আসল অর্ডারের কেনার সময়ের স্ন্যাপশট দামে, বদলির আইটেম বর্তমান
        ক্যাটালগ দামে — পার্থক্য আসল <code>computeExchange()</code> দিয়ে। এটি শুধু হিসাব;
        আসল এক্সচেঞ্জ সম্পন্ন হয় অর্ডারের রিটার্ন প্যানেল থেকে (ওয়ার্কস্পেস)।
      </p>
      {orders.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">কোনো অর্ডার পাওয়া যায়নি।</p>
      ) : (
        <>
          <OrderPicker orders={orders} value={selectedId ?? ""} onChange={(id) => { setOrderId(id); setReturnedVariantId(""); }} label="ফেরতের অর্ডার" />
          {detailError ? <PanelMessage ok={false} text={detailError} /> : null}
          {!detail && !detailError ? <p className="mt-3 text-sm text-text-muted">অর্ডার লোড হচ্ছে…</p> : null}
          {detail && returnedItem ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">ফেরত আসছে (অর্ডারের লাইন)</span>
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
                  <span className="mb-1 block text-xs font-medium text-text-muted">বদলে যাচ্ছে (ক্যাটালগ)</span>
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
                <Input label="ফেরতের পরিমাণ" name="returned-qty" type="number" min="0" value={returnedQty} onChange={(e) => setReturnedQty(e.target.value)} />
                <Input label="বদলির পরিমাণ" name="replacement-qty" type="number" min="0" value={replacementQty} onChange={(e) => setReplacementQty(e.target.value)} />
              </div>
              {result ? (
                <>
                  <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                    <div><dt className="text-text-muted">ফেরতের মূল্য</dt><dd><Money poisha={result.returnedValuePoisha} /></dd></div>
                    <div><dt className="text-text-muted">বদলির মূল্য</dt><dd><Money poisha={result.replacementValuePoisha} /></dd></div>
                    <div>
                      <dt className="text-text-muted">পার্থক্য</dt>
                      <dd><Money poisha={result.differencePoisha} /></dd>
                    </div>
                  </dl>
                  <p className="mt-3">
                    <Badge tone={result.direction === "EVEN" ? "neutral" : result.direction === "CUSTOMER_OWES" ? "warning" : "info"}>
                      {directionBn}
                    </Badge>
                  </p>
                </>
              ) : (
                <p className="mt-3 text-sm text-text-muted">ক্যাটালগে সক্রিয় ভ্যারিয়েন্ট পাওয়া যায়নি — বদলির হিসাব করা যাচ্ছে না।</p>
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
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">অর্ডার মার্জ</h2>
      <p className="mt-2 text-sm text-text-muted">
        ⚠️ <strong>অর্ডার মার্জ এখনো তৈরি হয়নি।</strong> দুটি অর্ডার এক করার কোনো API বা
        ব্যাকএন্ড এই সিস্টেমে নেই (master plan doc 21 §4-এ তালিকাভুক্ত)।{" "}
        <code>validateOrderMerge()</code> একটি pure যাচাই ফাংশন হিসেবে src/advanced-orders-এ
        আছে, কিন্তু মার্জ কার্যকর করার কোনো পথ নেই — তাই আগের ডেমো প্যানেলের বদলে এই নোট:
        এখানে কোনো ভুয়া মার্জ অ্যাকশন রাখা হয়নি। মার্জ দরকার হলে আপাতত একটি অর্ডার বাতিল
        করে অন্যটিতে লাইন যোগ করুন (অর্ডার এডিট, ওয়ার্কস্পেস থেকে)।
      </p>
    </Card>
  );
}

// ---- Pre-orders ----------------------------------------------------------------

function PreOrderPanel({ preOrders, onChanged }: { preOrders: PreOrder[]; onChanged: () => void }) {
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
        const division = window.prompt("বিভাগ / Division", "Dhaka");
        const district = window.prompt("জেলা / District", "Dhaka");
        const upazila = window.prompt("উপজেলা / Upazila", "");
        const addressLine = window.prompt("বিস্তারিত ঠিকানা / Address line", "");
        if (!division || !district || !upazila || !addressLine) {
          setMessage({ ok: false, text: `${pre.sku || pre.id}: ঠিকানা ছাড়া অর্ডার তৈরি বাতিল হয়েছে।` });
          return;
        }
        result = await post({ address: { division, district, upazila, addressLine } });
      }
      if (result.error) {
        setMessage({ ok: false, text: `${pre.sku || pre.id}: ${result.error.message ?? result.error.code ?? "Fulfilment failed."}` });
        return;
      }
      setMessage({
        ok: true,
        text: `${pre.sku || pre.id}: আসল অর্ডার তৈরি হয়েছে — ${result.data?.orderNo ?? ""}${result.meta?.alreadyConverted ? " (আগেই তৈরি ছিল)" : ""}; বাকি পরিশোধ্য ${formatPoisha(result.data?.payablePoisha ?? 0)}।`,
      });
      onChanged();
    } catch {
      setMessage({ ok: false, text: `${pre.sku || pre.id}: নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।` });
    } finally {
      setFulfillingId(null);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">প্রি-অর্ডার তালিকা</h2>
      <p className="mt-1 text-sm text-text-muted">
        GET /api/v1/admin/advanced-orders থেকে আসল ডাটাবেস রো; জমা ও বাকির হিসাব আসল{" "}
        <code>preOrderDuePoisha()</code> দিয়ে। "আসল অর্ডার তৈরি" সার্ভারে সত্যিকারের অর্ডার
        তৈরি করে — জমা ক্রেডিটসহ — এবং প্রি-অর্ডারটি FULFILLED চিহ্নিত করে। আংশিক সরবরাহের
        পরিমাণ ডাটাবেসে সংরক্ষণের কলাম/এন্ডপয়েন্ট নেই, তাই আগের পেজ-স্টেট "১টি সরবরাহ"
        বোতামটি সরানো হয়েছে — যা সংরক্ষণ হয় না, তা এখানে দেখানো হয় না।
      </p>
      {preOrders.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">ডাটাবেসে কোনো প্রি-অর্ডার নেই।</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-2 pr-3 font-medium">SKU / ভ্যারিয়েন্ট</th>
                <th className="py-2 pr-3 font-medium">গ্রাহক</th>
                <th className="py-2 pr-3 font-medium">পরিমাণ</th>
                <th className="py-2 pr-3 font-medium">মোট</th>
                <th className="py-2 pr-3 font-medium">জমা</th>
                <th className="py-2 pr-3 font-medium">বাকি</th>
                <th className="py-2 pr-3 font-medium">সরবরাহ</th>
                <th className="py-2 pr-3 font-medium">প্রত্যাশিত তারিখ</th>
                <th className="py-2 pr-3 font-medium">অবস্থা</th>
                <th className="py-2 font-medium">অ্যাকশন</th>
              </tr>
            </thead>
            <tbody>
              {preOrders.map((pre) => {
                const total = pre.unitPricePoisha * pre.quantity;
                const statusMeta = PREORDER_STATUS_BN[pre.status];
                return (
                  <tr key={pre.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono">{pre.sku || pre.productVariantId}</td>
                    <td className="py-2 pr-3"><Phone phone={pre.customerPhone} /></td>
                    <td className="py-2 pr-3">{pre.quantity}টি</td>
                    <td className="py-2 pr-3"><Money poisha={total} /></td>
                    <td className="py-2 pr-3"><Money poisha={pre.depositPoisha} /></td>
                    <td className="py-2 pr-3"><Money poisha={preOrderDuePoisha(pre)} /></td>
                    <td className="py-2 pr-3">{pre.fulfilledQty}/{pre.quantity}</td>
                    <td className="py-2 pr-3">{pre.expectedDate}</td>
                    <td className="py-2 pr-3"><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge></td>
                    <td className="py-2">
                      {pre.status !== "FULFILLED" && pre.status !== "CANCELLED" && pre.depositPoisha > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={fulfillingId === pre.id}
                          onClick={() => fulfilToOrder(pre)}
                        >
                          {fulfillingId === pre.id ? "তৈরি হচ্ছে…" : "আসল অর্ডার তৈরি"}
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
      )}
      {message ? <PanelMessage ok={message.ok} text={message.text} /> : null}
    </Card>
  );
}

// ---- Stock transfers (read-only, real rows) -------------------------------------

function TransfersCard({ transfers }: { transfers: StockTransfer[] }) {
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">স্টক ট্রান্সফার</h2>
      <p className="mt-1 text-sm text-text-muted">
        একই GET /api/v1/admin/advanced-orders থেকে আসল ট্রান্সফার রো — শুধু দেখার জন্য;
        ট্রান্সফার তৈরি/আপডেট হয় ইনভেন্টরি মুভমেন্ট থেকে।
      </p>
      {transfers.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">ডাটাবেসে কোনো স্টক ট্রান্সফার নেই।</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-text-muted">
                <th className="py-2 pr-3 font-medium">থেকে → তে</th>
                <th className="py-2 pr-3 font-medium">লাইন</th>
                <th className="py-2 pr-3 font-medium">তৈরি</th>
                <th className="py-2 pr-3 font-medium">পাঠানো</th>
                <th className="py-2 pr-3 font-medium">পৌঁছেছে</th>
                <th className="py-2 font-medium">অবস্থা</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const meta = TRANSFER_STATUS_BN[t.status];
                return (
                  <tr key={t.id} className="border-b border-border/60">
                    <td className="py-2 pr-3 font-mono">{t.fromWarehouseId} → {t.toWarehouseId}</td>
                    <td className="py-2 pr-3">
                      {t.lines.map((l) => `${l.sku} × ${l.quantity}`).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-3">{t.createdAt.slice(0, 10)}</td>
                    <td className="py-2 pr-3">{t.dispatchedAt ? t.dispatchedAt.slice(0, 10) : "—"}</td>
                    <td className="py-2 pr-3">{t.receivedAt ? t.receivedAt.slice(0, 10) : "—"}</td>
                    <td className="py-2"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---- Page body -------------------------------------------------------------------

export function AdvancedOrdersClient() {
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
    await attempt("প্রি-অর্ডার/ট্রান্সফার", () => loadAdvanced(), undefined);
    setOrders(
      await attempt("অর্ডার তালিকা", () => getJson<OrderRow[]>("/api/v1/admin/orders?page=1&pageSize=50"), []),
    );
    setInventory(
      await attempt(
        "ইনভেন্টরি",
        async () => (await getJson<{ items: InventoryRow[] }>("/api/v1/admin/inventory")).items ?? [],
        [],
      ),
    );
    setProducts(
      await attempt(
        "ক্যাটালগ",
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
    return <p className="text-sm text-text-muted">আসল ডেটা লোড হচ্ছে…</p>;
  }

  return (
    <div className="space-y-6">
      {failedFeeds.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>কিছু ফিড লোড হয়নি:</strong> {failedFeeds.join(", ")}। সংশ্লিষ্ট প্যানেল খালি
          দেখাতে পারে — ডেটা বানিয়ে দেখানো হয়নি।{" "}
          <button type="button" className="underline" onClick={() => void loadAll()}>
            আবার চেষ্টা করুন
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
