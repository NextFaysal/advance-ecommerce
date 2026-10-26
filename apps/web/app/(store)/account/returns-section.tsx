"use client";

/**
 * Account returns section (doc 17 batch O7, part 2) — mounted by the
 * /account server page under the order history.
 *
 * Two halves:
 *  1. "আমার রিটার্নসমূহ" — the customer's returns with bilingual
 *     status labels, fetched from GET /api/v1/public/account/returns.
 *     This list is the customer-visible status surface: it is always
 *     current, unlike the SMS updates, which are QUEUED jobs (no
 *     worker/provider until the VPS) — the copy below says exactly
 *     that, never "SMS sent".
 *  2. "রিটার্নের আবেদন" — per DELIVERED order (from the page's own
 *     order list), a form fed by GET .../orders/[id]/returns
 *     (returnable lines with already-claimed quantities subtracted
 *     server-side) and submitted to the same route's POST.
 *
 * Guests cannot apply online (no guest token flow by design) — the
 * section copy sends them to the hotline.
 */
import { useCallback, useEffect, useState } from "react";
import { BdtAmount } from "@/components/ui/numerals";
import { Icon } from "@/components/ui/icon";
import { lineTotalPoisha, qtyNumber } from "@/lib/quantity";

interface OrderProp {
  id: string;
  orderNo: string;
  status: string;
}

interface ReturnLineView {
  productName: string;
  sku: string;
  quantity: number;
  unitPricePoisha: number;
}

interface ReturnView {
  id: string;
  orderId: string;
  orderNo: string;
  status: string;
  statusLabel: { bn: string; en: string };
  reason: string | null;
  createdAt: string;
  lines: ReturnLineView[];
}

interface ReturnableLine {
  orderItemId: string;
  productName: string;
  sku: string;
  unitPricePoisha: number;
  orderedQuantity: number;
  alreadyRequestedQuantity: number;
  returnableQuantity: number;
}

interface FormFeed {
  eligible: boolean;
  code?: string;
  message?: string;
  windowDays?: number;
  deliveredAt?: string | null;
  lines: ReturnableLine[];
}

type LineChoice = { checked: boolean; quantity: number; reason: string };

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

function ReturnApplyForm({
  order,
  onDone,
}: {
  order: OrderProp;
  onDone: (message: string) => void;
}) {
  const [feed, setFeed] = useState<FormFeed | null>(null);
  const [choices, setChoices] = useState<Record<string, LineChoice>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/public/account/orders/${order.id}/returns`);
        const json = (await res.json()) as { data?: FormFeed; error?: { message?: string } };
        if (cancelled) return;
        if (json.data) {
          setFeed(json.data);
          const initial: Record<string, LineChoice> = {};
          for (const line of json.data.lines) {
            initial[line.orderItemId] = { checked: false, quantity: line.returnableQuantity, reason: "" };
          }
          setChoices(initial);
        } else {
          setError(json.error?.message ?? "তথ্য লোড করা যায়নি।");
        }
      } catch {
        if (!cancelled) setError("তথ্য লোড করা যায়নি। আবার চেষ্টা করুন।");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const submit = async () => {
    const items = Object.entries(choices)
      .filter(([, c]) => c.checked)
      .map(([orderItemId, c]) => ({
        orderItemId,
        quantity: c.quantity,
        ...(c.reason.trim() ? { reason: c.reason.trim() } : {}),
      }));
    if (items.length === 0) {
      setError("অন্তত একটি পণ্য বেছে নিন। / Select at least one item.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/account/orders/${order.id}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, ...(note.trim() ? { customerNote: note.trim() } : {}) }),
      });
      const json = (await res.json()) as {
        data?: { returnId: string; status: string };
        meta?: { sms?: string };
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "আবেদন জমা দেওয়া যায়নি।");
        return;
      }
      onDone(
        json.meta?.sms === "queued"
          ? "রিটার্নের আবেদন গৃহীত হয়েছে। এসএমএস আপডেট পাঠানোর জন্য কিউতে রাখা হয়েছে — এসএমএস সার্ভিস চালু হলে তা যাবে; আপাতত অবস্থা এই পেজেই দেখুন।"
          : "রিটার্নের আবেদন গৃহীত হয়েছে। অবস্থা এই পেজেই দেখতে পাবেন।",
      );
    } catch {
      setError("আবেদন জমা দেওয়া যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  if (error !== null && feed === null) {
    return <p className="mt-2 text-sm leading-6 text-red-700">{error}</p>;
  }
  if (feed === null) {
    return <p className="mt-2 text-sm text-text-muted">লোড হচ্ছে…</p>;
  }
  if (!feed.eligible) {
    return (
      <p className="mt-2 text-sm leading-6 text-text-muted">
        {feed.message ?? "এই অর্ডারের জন্য অনলাইনে রিটার্নের আবেদন করা যাচ্ছে না।"}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border bg-bg-app p-3.5">
      <p className="text-xs leading-5 text-text-muted">
        ডেলিভারি হয়েছে: {feed.deliveredAt ? formatDate(feed.deliveredAt) : "—"} · আবেদনের সময়সীমা
        ডেলিভারির {feed.windowDays ?? 7} দিন। কোন পণ্য ফেরত দিতে চান বেছে নিন:
      </p>
      <ul className="mt-2.5 space-y-2.5">
        {feed.lines.map((line) => {
          const choice = choices[line.orderItemId] ?? { checked: false, quantity: 0, reason: "" };
          const disabled = line.returnableQuantity <= 0;
          return (
            <li key={line.orderItemId} className="rounded-lg border border-border bg-card px-3 py-2.5">
              <label className="flex items-start gap-2.5">
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={disabled}
                  checked={choice.checked}
                  onChange={(e) =>
                    setChoices((prev) => ({
                      ...prev,
                      [line.orderItemId]: { ...choice, checked: e.target.checked },
                    }))
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-main">
                    {line.productName}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {line.sku} · <BdtAmount poisha={line.unitPricePoisha} /> · কেনা হয়েছিল{" "}
                    {line.orderedQuantity}টি
                    {line.alreadyRequestedQuantity > 0
                      ? ` · আগের আবেদনে ${line.alreadyRequestedQuantity}টি`
                      : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="text-xs text-text-muted">পরিমাণ</span>
                  <input
                    type="number"
                    min={0.001}
                    step={0.001}
                    max={line.returnableQuantity}
                    disabled={disabled || !choice.checked}
                    value={choice.quantity}
                    onChange={(e) =>
                      setChoices((prev) => ({
                        ...prev,
                        [line.orderItemId]: {
                          ...choice,
                          // Wave 59: fractional returns allowed to
                          // 3 decimals (weighted lines); milli-exact.
                          quantity: Math.min(
                            line.returnableQuantity,
                            Math.max(0.001, qtyNumber(Number(e.target.value) || 0)),
                          ),
                        },
                      }))
                    }
                    className="w-16 rounded-md border border-border bg-card px-2 py-1 text-sm text-text-main"
                  />
                </span>
              </label>
              {choice.checked ? (
                <input
                  type="text"
                  maxLength={300}
                  placeholder="কারণ (ঐচ্ছিক) — যেমন: সাইজ মেলেনি / Reason (optional)"
                  value={choice.reason}
                  onChange={(e) =>
                    setChoices((prev) => ({
                      ...prev,
                      [line.orderItemId]: { ...choice, reason: e.target.value },
                    }))
                  }
                  className="mt-2 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-text-main"
                />
              ) : null}
            </li>
          );
        })}
      </ul>
      <textarea
        maxLength={500}
        rows={2}
        placeholder="মন্তব্য (ঐচ্ছিক) / Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="mt-2.5 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-text-main"
      />
      {error !== null ? <p className="mt-2 text-sm leading-6 text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {busy ? "জমা হচ্ছে…" : "আবেদন জমা দিন"}
        </button>
      </div>
    </div>
  );
}

export default function ReturnsSection({ orders }: { orders: OrderProp[] }) {
  const [returns, setReturns] = useState<ReturnView[] | null>(null);
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/public/account/returns");
      const json = (await res.json()) as { data?: { returns: ReturnView[] } };
      setReturns(json.data?.returns ?? []);
    } catch {
      setReturns([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const deliveredOrders = orders.filter((o) => o.status === "DELIVERED");

  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label="আমার রিটার্নসমূহ"
    >
      <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
        >
          <Icon name="rotate-ccw" size={18} />
        </span>
        আমার রিটার্নসমূহ
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        ডেলিভারি সম্পন্ন অর্ডারের পণ্য ফেরত বা বদলির আবেদন এখান থেকে করা যায়। আবেদনের অবস্থা এই
        তালিকাতেই সবসময় হালনাগাদ থাকে।
      </p>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        অ্যাকাউন্ট ছাড়া (অতিথি হিসেবে) অর্ডার করে থাকলে অনলাইনে আবেদন করা যায় না — আমাদের হটলাইনে
        কল করুন, আমরা আপনার আবেদনটি তৈরি করে দেব।
      </p>

      {flash !== null ? (
        <p className="mt-3 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm leading-6 text-brand-700">
          {flash}
        </p>
      ) : null}

      {returns === null ? (
        <p className="mt-4 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : returns.length === 0 ? (
        <p className="mt-4 text-sm leading-6 text-text-muted">এখনো কোনো রিটার্নের আবেদন নেই।</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {returns.map((r) => (
            <li key={r.id} className="rounded-xl border border-border px-4 py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                >
                  <Icon name="rotate-ccw" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-text-main">
                      <a
                        href={`/track?orderNo=${encodeURIComponent(r.orderNo)}`}
                        className="hover:text-brand-700 hover:underline"
                      >
                        {r.orderNo}
                      </a>
                      <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                        {r.statusLabel.bn}
                      </span>
                    </p>
                    <span className="shrink-0 text-xs text-text-muted">{formatDate(r.createdAt)}</span>
                  </div>
                  {r.lines.length > 0 ? (
                    <ul className="mt-1.5 space-y-0.5 text-xs leading-5 text-text-muted">
                      {r.lines.map((line, i) => (
                        <li key={i}>
                          {line.productName} × {line.quantity} —{" "}
                          <BdtAmount poisha={lineTotalPoisha(line.unitPricePoisha, line.quantity)} />
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {r.reason ? <p className="mt-1 text-xs leading-5 text-text-muted">কারণ: {r.reason}</p> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {deliveredOrders.length > 0 ? (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-bold text-text-main">নতুন রিটার্নের আবেদন</h3>
          <ul className="mt-2 space-y-2">
            {deliveredOrders.map((order) => (
              <li key={order.id} className="rounded-xl border border-border px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2.5 text-sm font-medium text-text-main">
                    <span
                      aria-hidden="true"
                      className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
                    >
                      <Icon name="package" size={15} />
                    </span>
                    {order.orderNo}
                  </p>
                  <button
                    type="button"
                    onClick={() => setOpenOrderId(openOrderId === order.id ? null : order.id)}
                    className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    রিটার্নের আবেদন
                  </button>
                </div>
                {openOrderId === order.id ? (
                  <ReturnApplyForm
                    order={order}
                    onDone={(message) => {
                      setFlash(message);
                      setOpenOrderId(null);
                      void load();
                    }}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
