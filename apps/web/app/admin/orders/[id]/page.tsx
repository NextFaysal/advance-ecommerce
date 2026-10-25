"use client";

// Admin order detail — REAL data from GET /api/v1/admin/orders/[id]
// (Prisma-backed; phone masked server-side for viewers without
// customers.view_full_phone). Status changes go through
// PATCH /api/v1/admin/orders/[id], which runs the state machine
// server-side and persists: invalid transitions come back 422 and are
// shown, never applied locally. The allowed-transition buttons are
// computed from the same state-machine table the server enforces.
// The order payload carries customerId (from the order's customer
// relation), so the customer profile aggregates are loaded from
// GET /api/v1/admin/customers/[customerId] and the summary card gets
// its full view; if that fetch is not permitted (customers.view) the
// card falls back to its order-only view.
//
// Presentation (Design Refresh R3): header summary band, card sections
// for items / customer / timeline / actions / notes. Data flow unchanged.
import { useCallback, useEffect, useState } from "react";
import type { Customer, Order, OrderStatus } from "../../../../src/orders/types";
import { nextStepLabel, nextStepTarget, ORDER_TRANSITIONS } from "../../../../src/orders/state-machine";
import { displayPhone, riskLevel } from "../../../../src/orders/customer";
import { formatBdt } from "../../../../src/checkout/pricing";
import { CustomerSummaryCard } from "../../../../src/orders/components/CustomerSummaryCard";
import { OneClickPanel } from "../../../../src/orders/components/OneClickPanel";
import { PrintPanel } from "../../../../src/orders/components/PrintPanel";
import { RefundsPanel } from "./refunds-panel";
import { StatusTimeline } from "../../../../src/orders/components/StatusTimeline";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PaymentBadge, type PaymentStatus as UiPaymentStatus } from "@/components/ui/status-badge";

type DetailResponse =
  | { data: Order; meta?: unknown }
  | { error: { code: string; message: string } };

const STATUS_META: Record<string, { label: string; tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral"; dot: string }> = {
  PENDING: { label: "অপেক্ষমাণ", tone: "warning", dot: "#F59E0B" },
  CONFIRMED: { label: "নিশ্চিত", tone: "info", dot: "#0EA5E9" },
  PROCESSING: { label: "প্রসেসিং", tone: "brand", dot: "#8B5CF6" },
  PACKED: { label: "প্যাক করা", tone: "brand", dot: "#7C3AED" },
  SHIPPED: { label: "পাঠানো হয়েছে", tone: "info", dot: "#6366F1" },
  DELIVERED: { label: "ডেলিভার্ড", tone: "success", dot: "#10B981" },
  FAILED: { label: "ব্যর্থ", tone: "danger", dot: "#F43F5E" },
  RETURN_REQUESTED: { label: "রিটার্ন অনুরোধ", tone: "warning", dot: "#F97316" },
  RETURNING: { label: "রিটার্ন আসছে", tone: "warning", dot: "#F97316" },
  RETURNED: { label: "রিটার্ন হয়েছে", tone: "neutral", dot: "#94A3B8" },
  CANCELLED: { label: "বাতিল", tone: "neutral", dot: "#94A3B8" },
  REFUNDED: { label: "রিফান্ড", tone: "info", dot: "#14B8A6" },
  EXCHANGED: { label: "এক্সচেঞ্জ", tone: "info", dot: "#14B8A6" },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি",
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  card: "কার্ড",
  sslcommerz: "SSLCommerz",
};

const UI_PAYMENT_STATUSES: readonly string[] = ["UNPAID", "PARTIAL", "PAID", "FAILED", "REFUNDED"];

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-h3">{children}</h2>
      {sub ? <p className="mt-0.5 text-small text-text-muted">{sub}</p> : null}
    </div>
  );
}

export default function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(params.id)}`);
      const body = (await res.json().catch(() => null)) as DetailResponse | null;
      if (res.ok && body && "data" in body) {
        setOrder(body.data);
        setLoadState("ready");
        // Customer aggregates via customerId (best-effort: a viewer
        // without customers.view keeps the order-only card).
        setCustomer(null);
        if (body.data.customerId) {
          try {
            const cres = await fetch(`/api/v1/admin/customers/${encodeURIComponent(body.data.customerId)}`);
            const cbody = (await cres.json().catch(() => null)) as
              | { data?: { customer?: Customer } }
              | null;
            if (cres.ok && cbody?.data?.customer) setCustomer(cbody.data.customer);
          } catch {
            // Order-only fallback — the card renders without aggregates.
          }
        }
      } else if (res.status === 404) {
        setLoadState("notfound");
      } else {
        setLoadError(body && "error" in body ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
        setLoadState("error");
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setLoadState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyTransition(to: OrderStatus) {
    if (!order || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, reason: reason.trim() === "" ? undefined : reason.trim() }),
      });
      const body = (await res.json().catch(() => null)) as DetailResponse | null;
      if (res.ok && body && "data" in body) {
        setOrder(body.data);
        setMessage(`স্ট্যাটাস বদল হয়েছে (ডাটাবেসে সেভ হয়েছে): ${order.status} → ${to}`);
      } else if (body && "error" in body) {
        setMessage(`বাতিল হয়েছে (${res.status}): ${body.error.code}: ${body.error.message} — কিছু সেভ হয়নি।`);
      } else {
        setMessage(`বাতিল হয়েছে: HTTP ${res.status} — কিছু সেভ হয়নি।`);
      }
    } catch {
      setMessage("নেটওয়ার্ক সমস্যা — স্ট্যাটাস বদল পাঠানো যায়নি, কিছু সেভ হয়নি।");
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main>
        <div role="status" aria-label="অর্ডার লোড হচ্ছে" className="rounded-lg border border-border bg-card p-6 shadow-card">
          <div className="h-6 w-48 animate-pulse rounded bg-border" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="h-24 animate-pulse rounded-md bg-surface-2" />
            <div className="h-24 animate-pulse rounded-md bg-surface-2" />
          </div>
          <p className="mt-4 text-small text-text-muted">অর্ডার লোড হচ্ছে…</p>
        </div>
      </main>
    );
  }
  if (loadState === "notfound") {
    return (
      <main>
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-7 w-7">
              <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <h1 className="mt-4 text-h2">অর্ডার পাওয়া যায়নি</h1>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            আইডি: <span className="font-mono">{params.id}</span> — ডাটাবেসে এই আইডি/অর্ডার নম্বরের কোনো অর্ডার নেই।
          </p>
          <a
            href="/admin/orders"
            className="mt-5 inline-flex min-h-[44px] items-center justify-center rounded-md border border-border bg-card px-4 text-sm font-semibold shadow-sm transition motion-fast hover:bg-surface-2"
          >
            অর্ডার তালিকায় ফিরুন
          </a>
        </div>
      </main>
    );
  }
  if (loadState === "error" || !order) {
    return (
      <main>
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-card">
          <p className="font-semibold text-rose-700">অর্ডার লোড হয়নি</p>
          <p className="mt-1 text-small text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      </main>
    );
  }

  const nextLabel = nextStepLabel(order.status);
  const nextTarget = nextStepTarget(order.status);
  const meta = STATUS_META[order.status] ?? { label: order.status, tone: "neutral" as const, dot: "#94A3B8" };
  const level = riskLevel(order.riskScore);
  const addressLine = [order.address.addressLine, order.address.upazila, order.address.district, order.address.division]
    .filter(Boolean)
    .join(", ");

  return (
    <main>
      <a href="/admin/orders" className="mb-4 inline-flex items-center gap-1.5 text-small font-medium text-text-muted transition motion-fast hover:text-brand-700">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        সব অর্ডার
      </a>

      {/* Header summary band */}
      <Card className="mb-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-h2 font-bold">{order.orderNo}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <Badge tone={meta.tone}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ background: meta.dot }} />
                {meta.label}
              </Badge>
              {UI_PAYMENT_STATUSES.includes(order.paymentStatus)
                ? <PaymentBadge status={order.paymentStatus as UiPaymentStatus} />
                : <Badge tone="neutral">{order.paymentStatus}</Badge>}
              <Badge tone="neutral">{PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}</Badge>
              <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                ঝুঁকি: {level === "High" ? "বেশি" : level === "Medium" ? "মাঝারি" : "কম"} ({order.riskScore})
              </Badge>
            </div>
            <p className="mt-2.5 text-small leading-relaxed text-text-muted">
              গ্রাহক: <span className="font-medium text-text-main">{order.customerName}</span> — {displayPhone(order.customerPhone, false)} (ডিফল্টভাবে মাস্ক করা)
              <br />
              কুরিয়ার: {order.courier ?? "—"} · ট্র্যাকিং: {order.trackingId ? <span className="font-mono">{order.trackingId}</span> : "—"}
              {addressLine ? <><br />ঠিকানা: {addressLine}</> : null}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-caption font-medium text-text-muted">মোট</p>
            <p className="font-mono text-h1 font-bold tabular-nums">{formatBdt(order.totalPoisha)}</p>
          </div>
        </div>
      </Card>

      <div className="grid items-start gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* Items */}
          <Card className="shadow-card">
            <SectionTitle>আইটেম ({order.items.length})</SectionTitle>
            <ul className="divide-y divide-border">
              {order.items.map((i) => (
                <li key={i.variantId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-surface-2 text-brand-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                      <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium leading-snug">{i.productName}</p>
                    <p className="font-mono text-caption text-text-muted">{i.sku} × {i.quantity}</p>
                  </div>
                  <p className="font-mono font-semibold tabular-nums">{formatBdt(i.unitPricePoisha * i.quantity)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
              <span className="font-semibold">মোট</span>
              <span className="font-mono text-h3 font-bold tabular-nums">{formatBdt(order.totalPoisha)}</span>
            </div>
          </Card>

          {/* Customer summary — shared component (full aggregates when
              the customer fetch succeeded) */}
          <div className="[&_section]:shadow-card">
            <CustomerSummaryCard order={order} customer={customer ?? undefined} />
          </div>
          {order.customerId && (
            <p className="-mt-2 px-1 text-caption leading-relaxed text-text-subtle">
              <a
                href={`/admin/customers?search=${encodeURIComponent(order.customerName)}`}
                className="font-medium text-brand-700 hover:underline"
              >
                গ্রাহকের প্রোফাইল ও সব অর্ডার দেখুন
              </a>
              {customer ? "" : " — এই ভিউতে গ্রাহকের ইতিহাস দেখার অনুমতি না থাকলে কার্ডে শুধু এই অর্ডারের তথ্য দেখায়।"}
            </p>
          )}

          {/* Timeline — shared component */}
          <Card className="shadow-card">
            <SectionTitle>স্ট্যাটাস টাইমলাইন</SectionTitle>
            <StatusTimeline history={order.history} />
          </Card>

          {/* Notes */}
          <Card className="shadow-card">
            <SectionTitle>নোট</SectionTitle>
            {order.notes.length === 0 ? (
              <p className="text-small text-text-muted">কোনো নোট নেই।</p>
            ) : (
              <ul className="space-y-3">
                {order.notes.map((n) => (
                  <li key={n.id} className="rounded-md bg-surface-2 px-3.5 py-3">
                    <p className="leading-relaxed">{n.text}</p>
                    <p className="mt-1 text-caption text-text-muted">
                      {n.author} · <span className="font-mono tabular-nums">{n.createdAt}</span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          {/* Status actions */}
          <Card className="shadow-card">
            <SectionTitle sub="প্রতিটি বদল সার্ভারে স্টেট মেশিন দিয়ে যাচাই হয়ে ডাটাবেসে সেভ হয়; অবৈধ বদল বাতিল হয়ে উপরে দেখানো হয়।">
              পরবর্তী ধাপ / স্ট্যাটাস বদল
            </SectionTitle>
            {nextLabel && nextTarget && (
              <Button
                variant="gradient"
                className="w-full"
                disabled={busy}
                onClick={() => void applyTransition(nextTarget)}
              >
                {nextLabel}
              </Button>
            )}
            <label className="mb-1.5 mt-4 block text-small font-medium" htmlFor="transition-reason">
              কারণ (বাতিল/রিফান্ডের জন্য আবশ্যক)
            </label>
            <input
              id="transition-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="কারণ লিখুন"
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {ORDER_TRANSITIONS[order.status].map((to) => (
                <Button
                  key={to}
                  variant={to === nextTarget ? "primary" : "outline"}
                  size="sm"
                  disabled={busy}
                  onClick={() => void applyTransition(to)}
                >
                  {(STATUS_META[to]?.label ?? to)} করুন
                </Button>
              ))}
            </div>
            {message && (
              <p role="status" className="mt-4 rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed">
                {message}
              </p>
            )}
          </Card>

          {/* One-click panel — shared component */}
          <div className="[&_section]:shadow-card">
            <OneClickPanel order={order} onOrderChange={setOrder} />
          </div>

          {/* Print panel — shared component */}
          <div className="[&_section]:shadow-card">
            <PrintPanel order={order} />
          </div>

          {/* Refund workbench (doc 17, O0) — records refunds staff send
              via bKash/bank themselves; shows the refund-due banner for
              cancelled/returned orders. Self-fetches by order id. */}
          <RefundsPanel orderId={order.id} />
        </div>
      </div>

      <p className="mt-5 text-caption text-text-subtle">
        ডেটা উৎস: অ্যাডমিন অর্ডার API (ডাটাবেস) — স্ট্যাটাস বদল PATCH দিয়ে ডাটাবেসে সেভ হয়।
      </p>
    </main>
  );
}
