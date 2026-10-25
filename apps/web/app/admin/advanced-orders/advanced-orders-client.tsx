"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Money, formatPoisha } from "@/components/ui/money";
import { Phone } from "@/components/ui/phone";
import {
  allocateOrderItems, applyPartialPayment, applyPreOrderFulfilment, applyRefund,
  computeExchange, derivePaymentStatus, duePoisha, preOrderDuePoisha, validateOrderMerge,
  type DerivedPaymentStatus, type PartialPaymentState, type PreOrder, type PreOrderStatus,
} from "@/advanced-orders";
import type { OrderItem } from "@/orders/types";
import {
  SAMPLE_ITEMS, SAMPLE_MERGE_CANDIDATES, SAMPLE_PAYMENT_STATES,
  SAMPLE_SPLIT_ORDERS, SAMPLE_WAREHOUSES,
} from "./sample-data";

/**
 * Advanced Orders panels — Agent 43. CLIENT STATE ONLY (demo): every panel
 * runs the real pure functions from src/advanced-orders over SAMPLE data.
 * Nothing is submitted, persisted, or sent anywhere; results live in this
 * page's React state and are lost on reload. Real wiring: the same calls
 * exist server-side behind /api/v1/admin/advanced-orders (Prisma-backed
 * stores replace the demo store once Prisma generate succeeds).
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

// ---- Split planner ---------------------------------------------------------

function SplitPlanner() {
  const [orderId, setOrderId] = useState(SAMPLE_SPLIT_ORDERS[0].id);
  const order = SAMPLE_SPLIT_ORDERS.find((o) => o.id === orderId) ?? SAMPLE_SPLIT_ORDERS[0];
  const result = useMemo(
    () => allocateOrderItems(order.items, SAMPLE_WAREHOUSES),
    [order],
  );
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">স্প্লিট শিপমেন্ট প্ল্যানার</h2>
      <p className="mt-1 text-sm text-text-muted">
        অর্ডার বাছাই করলেই আসল <code>allocateOrderItems()</code> গুদামের অগ্রাধিকার অনুযায়ী
        স্টক ভাগ করে দেয়। যেটুকু কোনো গুদামেই নেই তা ব্যাকঅর্ডার হিসেবে আলাদা দেখানো হয় — কখনো লুকানো হয় না।
      </p>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-text-muted">SAMPLE অর্ডার</span>
        <select className={selectClass} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          {SAMPLE_SPLIT_ORDERS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.orderNo} — {o.items.reduce((s, i) => s + i.quantity, 0)}টি আইটেম, মোট {formatPoisha(o.totalPoisha)}
            </option>
          ))}
        </select>
      </label>

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
    </Card>
  );
}

// ---- Partial payment / refund ----------------------------------------------

function PaymentPanel() {
  const [orderId, setOrderId] = useState(SAMPLE_SPLIT_ORDERS[0].id);
  const [states, setStates] = useState<Record<string, PartialPaymentState>>(SAMPLE_PAYMENT_STATES);
  const [taka, setTaka] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const state = states[orderId];
  const status = derivePaymentStatus(state);

  const run = (kind: "pay" | "refund") => {
    const amountPoisha = Math.round(Number(taka) * 100);
    const result = kind === "pay"
      ? applyPartialPayment(state, amountPoisha)
      : applyRefund(state, amountPoisha);
    if (result.ok) {
      setStates((prev) => ({ ...prev, [orderId]: result.state }));
      setMessage({
        ok: true,
        text: kind === "pay"
          ? `পেমেন্ট গ্রহণ করা হয়েছে (ডেমো)। নতুন অবস্থা: ${PAYMENT_STATUS_BN[result.status]}।`
          : `রিফান্ড হিসাব করা হয়েছে (ডেমো)। নতুন অবস্থা: ${PAYMENT_STATUS_BN[result.status]}।`,
      });
    } else {
      // Rejection is the point of the demo: overpayment / over-refund are
      // refused by the real function, never clamped.
      setMessage({ ok: false, text: `প্রত্যাখ্যান (${result.code}): ${result.message}` });
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">আংশিক পেমেন্ট ও রিফান্ড</h2>
      <p className="mt-1 text-sm text-text-muted">
        আসল <code>applyPartialPayment()</code> / <code>applyRefund()</code> দিয়ে হিসাব হয়।
        মোটের বেশি পেমেন্ট বা পাওয়া টাকার বেশি রিফান্ড দিলে ফাংশনটি প্রত্যাখ্যান করে — চেষ্টা করে দেখুন।
      </p>
      <label className="mt-4 block">
        <span className="mb-1 block text-xs font-medium text-text-muted">SAMPLE অর্ডার</span>
        <select
          className={selectClass}
          value={orderId}
          onChange={(e) => { setOrderId(e.target.value); setMessage(null); }}
        >
          {SAMPLE_SPLIT_ORDERS.map((o) => (
            <option key={o.id} value={o.id}>{o.orderNo}</option>
          ))}
        </select>
      </label>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-text-muted">অর্ডার মোট</dt><dd><Money poisha={state.totalPoisha} /></dd></div>
        <div><dt className="text-text-muted">পরিশোধ হয়েছে</dt><dd><Money poisha={state.paidPoisha} /></dd></div>
        <div><dt className="text-text-muted">রিফান্ড হয়েছে</dt><dd><Money poisha={state.refundedPoisha} /></dd></div>
        <div><dt className="text-text-muted">বাকি (due)</dt><dd><Money poisha={duePoisha(state)} /></dd></div>
      </dl>
      <p className="mt-3">
        অবস্থা: <Badge tone={status === "PAID" ? "success" : status === "UNPAID" ? "danger" : "warning"}>
          {PAYMENT_STATUS_BN[status]} ({status})
        </Badge>
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <div className="min-w-40 flex-1">
          <Input
            label="পরিমাণ (টাকা)"
            name="amount-taka"
            type="number"
            min="0"
            step="0.01"
            value={taka}
            onChange={(e) => setTaka(e.target.value)}
            placeholder="যেমন 500"
          />
        </div>
        <Button type="button" onClick={() => run("pay")}>পেমেন্ট যোগ করুন</Button>
        <Button type="button" variant="secondary" onClick={() => run("refund")}>রিফান্ড করুন</Button>
      </div>
      {message ? <PanelMessage ok={message.ok} text={message.text} /> : null}
    </Card>
  );
}

// ---- Exchange calculator -----------------------------------------------------

function itemOptions(selected: string, onChange: (key: string) => void, label: string) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <select className={selectClass} value={selected} onChange={(e) => onChange(e.target.value)}>
        {Object.entries(SAMPLE_ITEMS).map(([key, item]) => (
          <option key={key} value={key}>{item.productName} — {formatPoisha(item.unitPricePoisha)}</option>
        ))}
      </select>
    </label>
  );
}

function ExchangePanel() {
  const [returnedKey, setReturnedKey] = useState("shirt");
  const [replacementKey, setReplacementKey] = useState("shoe");
  const [returnedQty, setReturnedQty] = useState("1");
  const [replacementQty, setReplacementQty] = useState("1");
  const returnedItem: OrderItem = SAMPLE_ITEMS[returnedKey];
  const replacementItem: OrderItem = SAMPLE_ITEMS[replacementKey];
  const result = computeExchange({
    orderId: "ord_sample_2001",
    returnedItem, returnedQty: Math.max(0, Math.trunc(Number(returnedQty) || 0)),
    replacementItem, replacementQty: Math.max(0, Math.trunc(Number(replacementQty) || 0)),
  });
  const directionBn = result.direction === "CUSTOMER_OWES"
    ? "গ্রাহক পার্থক্য পরিশোধ করবেন"
    : result.direction === "STORE_REFUNDS"
      ? "দোকান পার্থক্য ফেরত দেবে"
      : "সমান বিনিময় — কোনো পার্থক্য নেই";
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">এক্সচেঞ্জ ক্যালকুলেটর</h2>
      <p className="mt-1 text-sm text-text-muted">
        কেনার সময়ের স্ন্যাপশট দামে আসল <code>computeExchange()</code> পার্থক্য বের করে।
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {itemOptions(returnedKey, setReturnedKey, "ফেরত আসছে")}
        {itemOptions(replacementKey, setReplacementKey, "বদলে যাচ্ছে")}
        <Input label="ফেরতের পরিমাণ" name="returned-qty" type="number" min="0" value={returnedQty} onChange={(e) => setReturnedQty(e.target.value)} />
        <Input label="বদলির পরিমাণ" name="replacement-qty" type="number" min="0" value={replacementQty} onChange={(e) => setReplacementQty(e.target.value)} />
      </div>
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
    </Card>
  );
}

// ---- Merge checker -----------------------------------------------------------

function MergePanel() {
  const [aId, setAId] = useState(SAMPLE_MERGE_CANDIDATES[0].id);
  const [bId, setBId] = useState(SAMPLE_MERGE_CANDIDATES[1].id);
  const a = SAMPLE_MERGE_CANDIDATES.find((c) => c.id === aId) ?? SAMPLE_MERGE_CANDIDATES[0];
  const b = SAMPLE_MERGE_CANDIDATES.find((c) => c.id === bId) ?? SAMPLE_MERGE_CANDIDATES[1];
  const result = validateOrderMerge(a, b);
  const picker = (value: string, onChange: (v: string) => void, label: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {SAMPLE_MERGE_CANDIDATES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.orderNo} · {c.status} · <Phone phone={c.customerPhone} />
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">অর্ডার মার্জ যাচাই</h2>
      <p className="mt-1 text-sm text-text-muted">
        আসল <code>validateOrderMerge()</code>: একই গ্রাহক (ফোন), একই ঠিকানা, কোনোটাই শিপ হয়নি —
        সব ব্যর্থতার কারণ একসাথে দেখানো হয়। SAMPLE-3003 দিয়ে চেষ্টা করলে তিনটি কারণই আসবে।
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {picker(aId, setAId, "প্রথম অর্ডার")}
        {picker(bId, setBId, "দ্বিতীয় অর্ডার")}
      </div>
      {result.ok ? (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          মার্জ করা যাবে (ডেমো যাচাই)। সম্মিলিত মোট: <Money poisha={result.mergedTotalPoisha ?? 0} /> — আসল মার্জ এই পেজ থেকে করা হয় না।
        </p>
      ) : (
        <div className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="status">
          <p className="font-medium">মার্জ করা যাবে না — {result.reasons.length}টি কারণ:</p>
          <ul className="mt-1 list-inside list-disc">
            {result.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
    </Card>
  );
}

// ---- Pre-orders ----------------------------------------------------------------

function PreOrderPanel({ initialPreOrders }: { initialPreOrders: PreOrder[] }) {
  const [preOrders, setPreOrders] = useState<PreOrder[]>(initialPreOrders);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const fulfilOne = (pre: PreOrder) => {
    const result = applyPreOrderFulfilment(pre, 1);
    if (result.ok) {
      setPreOrders((prev) => prev.map((p) => (p.id === pre.id ? result.preOrder : p)));
      setMessage({ ok: true, text: `${pre.sku}: ১টি সরবরাহ ধরা হয়েছে (ডেমো) — অবস্থা এখন ${PREORDER_STATUS_BN[result.preOrder.status].label}।` });
    } else {
      setMessage({ ok: false, text: `${pre.sku}: ${result.message}` });
    }
  };

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
          setMessage({ ok: false, text: `${pre.sku}: ঠিকানা ছাড়া অর্ডার তৈরি বাতিল হয়েছে।` });
          return;
        }
        result = await post({ address: { division, district, upazila, addressLine } });
      }
      if (result.error) {
        setMessage({ ok: false, text: `${pre.sku}: ${result.error.message ?? result.error.code ?? "Fulfilment failed."}` });
        return;
      }
      setPreOrders((prev) =>
        prev.map((p) => (p.id === pre.id ? { ...p, status: "FULFILLED", fulfilledQty: p.quantity } : p)),
      );
      setMessage({
        ok: true,
        text: `${pre.sku}: আসল অর্ডার তৈরি হয়েছে — ${result.data?.orderNo ?? ""}${result.meta?.alreadyConverted ? " (আগেই তৈরি ছিল)" : ""}; বাকি পরিশোধ্য ${formatPoisha(result.data?.payablePoisha ?? 0)}।`,
      });
    } catch {
      setMessage({ ok: false, text: `${pre.sku}: নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।` });
    } finally {
      setFulfillingId(null);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-lg font-semibold">প্রি-অর্ডার তালিকা</h2>
      <p className="mt-1 text-sm text-text-muted">
        জমা ও বাকির হিসাব আসল <code>preOrderDuePoisha()</code> দিয়ে; "১টি সরবরাহ" বোতাম
        <code> applyPreOrderFulfilment()</code> চালায় — শুধু এই পেজের state বদলায়, কিছুই সংরক্ষণ হয় না।
        "আসল অর্ডার তৈরি" বোতাম (doc 17 O9-1) সার্ভারে সত্যিকারের অর্ডার তৈরি করে — জমা ক্রেডিটসহ —
        এবং প্রি-অর্ডারটি FULFILLED চিহ্নিত করে; জমা দেওয়া প্রি-অর্ডারেই শুধু দেখা যায়।
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted">
              <th className="py-2 pr-3 font-medium">SKU</th>
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
                  <td className="py-2 pr-3 font-mono">{pre.sku}</td>
                  <td className="py-2 pr-3"><Phone phone={pre.customerPhone} /></td>
                  <td className="py-2 pr-3">{pre.quantity}টি</td>
                  <td className="py-2 pr-3"><Money poisha={total} /></td>
                  <td className="py-2 pr-3"><Money poisha={pre.depositPoisha} /></td>
                  <td className="py-2 pr-3"><Money poisha={preOrderDuePoisha(pre)} /></td>
                  <td className="py-2 pr-3">{pre.fulfilledQty}/{pre.quantity}</td>
                  <td className="py-2 pr-3">{pre.expectedDate}</td>
                  <td className="py-2 pr-3"><Badge tone={statusMeta.tone}>{statusMeta.label}</Badge></td>
                  <td className="py-2">
                    <span className="inline-flex flex-wrap gap-1">
                      {pre.status === "OPEN" || pre.status === "PARTIALLY_FULFILLED" ? (
                        <Button type="button" size="sm" variant="secondary" onClick={() => fulfilOne(pre)}>
                          ১টি সরবরাহ
                        </Button>
                      ) : null}
                      {pre.status !== "FULFILLED" && pre.status !== "CANCELLED" && pre.depositPoisha > 0 ? (
                        <Button
                          type="button"
                          size="sm"
                          disabled={fulfillingId === pre.id}
                          onClick={() => fulfilToOrder(pre)}
                        >
                          {fulfillingId === pre.id ? "তৈরি হচ্ছে…" : "আসল অর্ডার তৈরি"}
                        </Button>
                      ) : null}
                      {pre.status !== "OPEN" && pre.status !== "PARTIALLY_FULFILLED" && pre.depositPoisha <= 0 ? (
                        <span className="text-text-muted">—</span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message ? <PanelMessage ok={message.ok} text={message.text} /> : null}
    </Card>
  );
}

// ---- Page body -------------------------------------------------------------------

export function AdvancedOrdersClient({ initialPreOrders }: { initialPreOrders: PreOrder[] }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <SplitPlanner />
        <PaymentPanel />
        <ExchangePanel />
        <MergePanel />
      </div>
      <PreOrderPanel initialPreOrders={initialPreOrders} />
    </div>
  );
}
