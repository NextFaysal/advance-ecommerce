"use client";

// Admin order detail — the ORDER WORKSPACE (doc 19, batch OD2).
// REAL data from GET /api/v1/admin/orders/[id] (Prisma-backed; phone
// masked server-side for viewers without customers.view_full_phone).
// Status changes go through PATCH /api/v1/admin/orders/[id], which
// runs the state machine server-side and persists: invalid
// transitions come back 422 and are shown, never applied locally.
// The allowed-transition buttons are computed from the same
// state-machine table the server enforces. The order payload carries
// customerId, so customer aggregates load from
// GET /api/v1/admin/customers/[customerId]; if that fetch is not
// permitted the summary card falls back to its order-only view.
//
// OD2 layout (presentation only — data flow unchanged): a header
// band (order no, OD0 status/payment badges, age chip, total, the
// primary next-step button), a sticky left rail (customer summary,
// contact + phone reveal, money breakdown, advance summary,
// delivery chips, management summary) and a tabbed main column
// (কাজ / পেমেন্ট ও রিফান্ড / শিপমেন্ট / রিটার্ন / পরিচালনা / ইতিহাস).
// Every panel keeps its established mount contract (self-fetching
// by orderId, serialisable props only). On mobile the rail stacks
// above the tabs and the tab list scrolls horizontally.
import { useCallback, useEffect, useState } from "react";
import type { Customer, Order, OrderStatus } from "../../../../src/orders/types";
import { nextStepLabel, nextStepTarget, ORDER_TRANSITIONS } from "../../../../src/orders/state-machine";
import { displayPhone, riskLevel } from "../../../../src/orders/customer";
import { formatBdt } from "../../../../src/checkout/pricing";
import { CustomerSummaryCard } from "../../../../src/orders/components/CustomerSummaryCard";
import { OneClickPanel } from "../../../../src/orders/components/OneClickPanel";
import { PrintPanel } from "../../../../src/orders/components/PrintPanel";
import { RefundsPanel } from "./refunds-panel";
import { ShipmentsPanel } from "./shipments-panel";
import { PhoneReveal } from "./phone-reveal";
import { EditPanel } from "./edit-panel";
import { ManagementPanel } from "./management-panel";
import { ReturnsPanel } from "./returns-panel";
import { AdvancePanel } from "./advance-panel";
import type { OrderAdvanceView } from "../../../../src/orders/advance";
import { StatusTimeline } from "../../../../src/orders/components/StatusTimeline";
import {
  OrderPaymentBadge,
  OrderStatusBadge,
} from "../../../../src/orders/components/OrderStatusBadge";
import {
  ORDER_STATUS_BN,
  PAYMENT_STATUS_VISUAL,
} from "../../../../src/orders/components/labels";
import { MoneyBreakdown } from "../../../../src/orders/components/MoneyBreakdown";
import { ORDER_DENSITY } from "../../../../src/orders/components/density";
import { orderAgeLabel, previewMoneyProps } from "../list-helpers";
import { buildWorkspaceTimelineEntries } from "./workspace-timeline";
import { RailAdvanceSummary } from "./rail-advance-summary";
import { RailManagementSummary } from "./rail-management-summary";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";

type DetailOrder = Order & { advance?: OrderAdvanceView };

/**
 * Delivery-slot label (doc 17 batch O9-2): Order.deliverySlot stores
 * the slot ID from Settings orders.delivery_slots; the bilingual
 * label is display-time, resolved from the public slots endpoint.
 * Falls back to the raw id (a slot renamed/removed after the order
 * was placed still shows SOMETHING truthful, never a wrong label).
 */
function SlotLabel({ slotId }: { slotId: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/delivery-slots")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("slots"))))
      .then((json: { data?: { slots?: { id: string; labelBn: string; labelEn: string }[] } }) => {
        if (cancelled) return;
        const match = json.data?.slots?.find((s) => s.id === slotId);
        if (match) setLabel(`${match.labelBn} / ${match.labelEn}`);
      })
      .catch(() => {
        // Raw id fallback below.
      });
    return () => {
      cancelled = true;
    };
  }, [slotId]);
  return <>{label ?? slotId}</>;
}

type DetailResponse =
  | { data: DetailOrder; meta?: unknown }
  | { error: { code: string; message: string } };

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি",
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  card: "কার্ড",
  sslcommerz: "SSLCommerz",
};

function SectionTitle({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-h3">{children}</h2>
      {sub ? <p className="mt-0.5 text-small text-text-muted">{sub}</p> : null}
    </div>
  );
}

export default function AdminOrderDetailPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<DetailOrder | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "error" | "notfound" | "ready">("loading");
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  // Tab navigation seed: ui/tabs owns its active state, so the rail's
  // "পেমেন্ট ও রিফান্ড ট্যাবে বিস্তারিত" jump re-seeds the Tabs mount
  // (key change) with the payment tab as the default. Ordinary tab
  // clicks never touch this state.
  const [tabSeed, setTabSeed] = useState<{ id: string; n: number }>({ id: "actions", n: 0 });

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
        // The PATCH payload is the plain order (no advance read
        // model) — keep the loaded advance block across the change.
        setOrder({ ...body.data, advance: order.advance });
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
  const level = riskLevel(order.riskScore);
  const addressLine = [order.address.addressLine, order.address.upazila, order.address.district, order.address.division]
    .filter(Boolean)
    .join(", ");
  const ageLabel = orderAgeLabel(order.createdAt, Date.now());
  const paymentKnown = (Object.keys(PAYMENT_STATUS_VISUAL) as string[]).includes(order.paymentStatus);
  const timelineEntries = buildWorkspaceTimelineEntries(order);
  const stack = ORDER_DENSITY.comfortable.stack;
  const hasGift = order.giftMessage !== null && order.giftMessage !== undefined;
  const showDeliveryCard = Boolean(order.courier || order.trackingId || order.deliverySlot || hasGift);

  return (
    <main>
      <a href="/admin/orders" className="mb-4 inline-flex items-center gap-1.5 text-small font-medium text-text-muted transition motion-fast hover:text-brand-700">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        সব অর্ডার
      </a>

      {/* Header band — order no, OD0 status language, age, total and
          the primary next-step affordance (the state machine's legal
          next transition; the full transition set + reason input live
          in the কাজ tab). */}
      <Card className="mb-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-h2 font-bold">{order.orderNo}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status} />
              {paymentKnown ? (
                <OrderPaymentBadge status={order.paymentStatus} />
              ) : (
                <Badge tone="neutral">{order.paymentStatus}</Badge>
              )}
              <Badge tone="neutral">{PAYMENT_METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}</Badge>
              <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                ঝুঁকি: {level === "High" ? "বেশি" : level === "Medium" ? "মাঝারি" : "কম"} ({order.riskScore})
              </Badge>
              {ageLabel ? (
                <Badge tone="neutral" icon={<Icon name="clock" size={12} />}>
                  {ageLabel}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2.5 text-small leading-relaxed text-text-muted">
              গ্রাহক: <span className="font-medium text-text-main">{order.customerName}</span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-caption font-medium text-text-muted">মোট</p>
            <p className="font-mono text-h1 font-bold tabular-nums">{formatBdt(order.totalPoisha)}</p>
            {nextLabel && nextTarget && (
              <Button
                variant="gradient"
                className="mt-3"
                disabled={busy}
                onClick={() => void applyTransition(nextTarget)}
              >
                {nextLabel}
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Transition result — shown under the header so it is visible
          from whichever tab (or the header button) triggered it. */}
      {message && (
        <p role="status" className="mb-5 rounded-md bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed">
          {message}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left rail — sticky on desktop; on mobile it stacks above
            the tabs as the order's summary. */}
        <div className={`${stack} lg:sticky lg:top-5 lg:max-h-[calc(100vh-2.5rem)] lg:overflow-y-auto`}>
          {/* Customer summary — shared component (full aggregates when
              the customer fetch succeeded) */}
          <div className="[&_section]:shadow-card">
            <CustomerSummaryCard order={order} customer={customer ?? undefined} />
          </div>

          {/* Contact + address — the phone reveal lives with the
              customer block (audited reveal; the payload's phone
              stays masked until it is used). */}
          <Card className="shadow-card">
            <h2 className="mb-3 text-base font-semibold">যোগাযোগ ও ঠিকানা</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-muted">ফোন</dt>
                <dd>
                  <PhoneReveal orderId={order.id} maskedPhone={displayPhone(order.customerPhone, false)} />
                </dd>
              </div>
              {addressLine ? (
                <div>
                  <dt className="text-text-muted">ঠিকানা</dt>
                  <dd className="mt-0.5 leading-relaxed">{addressLine}</dd>
                </div>
              ) : null}
            </dl>
            {order.customerId && (
              <p className="mt-3 text-caption leading-relaxed text-text-subtle">
                <a
                  href={`/admin/customers?search=${encodeURIComponent(order.customerName)}`}
                  className="font-medium text-brand-700 hover:underline"
                >
                  গ্রাহকের প্রোফাইল ও সব অর্ডার দেখুন
                </a>
                {customer ? "" : " — এই ভিউতে গ্রাহকের ইতিহাস দেখার অনুমতি না থাকলে কার্ডে শুধু এই অর্ডারের তথ্য দেখায়।"}
              </p>
            )}
          </Card>

          {/* Money — OD0 MoneyBreakdown fed exactly as the OD1
              preview feeds it (subtotal from items, doc-18 split
              passthrough, paid from the advance read model). */}
          <Card className="shadow-card">
            <h2 className="mb-3 text-base font-semibold">টাকার হিসাব</h2>
            <MoneyBreakdown {...previewMoneyProps(order)} />
          </Card>

          {/* Advance state summary — renders nothing for ordinary
              orders (same condition as AdvancePanel). */}
          <RailAdvanceSummary
            advance={order.advance}
            onShowPayments={() => setTabSeed((s) => ({ id: "payment", n: s.n + 1 }))}
          />

          {/* Delivery — courier / tracking / slot + gift chips. */}
          {showDeliveryCard ? (
            <Card className="shadow-card">
              <h2 className="mb-3 text-base font-semibold">ডেলিভারি</h2>
              <dl className="space-y-2 text-sm">
                {order.courier ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">কুরিয়ার</dt>
                    <dd className="font-medium">{order.courier}</dd>
                  </div>
                ) : null}
                {order.trackingId ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">ট্র্যাকিং</dt>
                    <dd className="font-mono">{order.trackingId}</dd>
                  </div>
                ) : null}
                {order.deliverySlot ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">ডেলিভারির সময়</dt>
                    <dd>
                      <Badge tone="info" icon={<Icon name="clock" size={12} />}>
                        <SlotLabel slotId={order.deliverySlot} />
                      </Badge>
                    </dd>
                  </div>
                ) : null}
                {hasGift ? (
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-text-muted">উপহার</dt>
                      <dd>
                        <Badge tone="brand" icon={<Icon name="sparkles" size={12} />}>
                          উপহার হিসেবে পাঠান
                        </Badge>
                      </dd>
                    </div>
                    <p className="mt-1.5 leading-relaxed text-text-muted">
                      {order.giftMessage ? (
                        <>বার্তা: <span className="font-medium text-text-main">“{order.giftMessage}”</span></>
                      ) : (
                        "বার্তা নেই"
                      )}
                    </p>
                  </div>
                ) : null}
              </dl>
            </Card>
          ) : null}

          {/* Management summary — assignee / priority / hold at a
              glance (read-only; editing lives in the পরিচালনা tab). */}
          <RailManagementSummary orderId={order.id} />
        </div>

        {/* Main column — tabbed work areas. Panels keep their
            self-fetch-by-orderId mount contract; ui/tabs renders
            the active tab only. */}
        <div className="min-w-0">
          <Tabs
            key={tabSeed.n}
            defaultId={tabSeed.id}
            tabs={[
              {
                id: "actions",
                label: "কাজ",
                content: (
                  <div className={stack}>
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

                    {/* Status actions — the full legal transition set
                        with the reason input (the primary next step
                        also sits in the header). */}
                    <Card className="shadow-card">
                      <SectionTitle sub="প্রতিটি বদল সার্ভারে স্টেট মেশিন দিয়ে যাচাই হয়ে ডাটাবেসে সেভ হয়; অবৈধ বদল বাতিল হয়ে উপরে দেখানো হয়।">
                        স্ট্যাটাস বদল
                      </SectionTitle>
                      <label className="mb-1.5 block text-small font-medium" htmlFor="transition-reason">
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
                            {ORDER_STATUS_BN[to]} করুন
                          </Button>
                        ))}
                      </div>
                    </Card>

                    {/* One-click panel — shared component */}
                    <div className="[&_section]:shadow-card">
                      <OneClickPanel order={order} onOrderChange={setOrder} />
                    </div>

                    {/* Print panel — shared component */}
                    <div className="[&_section]:shadow-card">
                      <PrintPanel order={order} />
                    </div>
                  </div>
                ),
              },
              {
                id: "payment",
                label: "পেমেন্ট ও রিফান্ড",
                content: (
                  <div className={stack}>
                    {/* Advance payment (doc 17, O3) — required/paid/
                        satisfied + OTP state + active payment link
                        from data.advance; renders nothing for
                        ordinary orders. */}
                    <AdvancePanel advance={order.advance} />
                    {/* Refund workbench (doc 17, O0) — self-fetches
                        by order id. */}
                    <RefundsPanel orderId={order.id} />
                  </div>
                ),
              },
              {
                id: "shipments",
                label: "শিপমেন্ট",
                // Shipments (doc 17, O5) — bookings incl. split
                // parcels; self-fetches by order id.
                content: <ShipmentsPanel orderId={order.id} />,
              },
              {
                id: "returns",
                label: "রিটার্ন",
                // Returns / RMA (doc 17, O7) — self-fetches by
                // order id.
                content: <ReturnsPanel orderId={order.id} />,
              },
              {
                id: "management",
                label: "পরিচালনা",
                content: (
                  <div className={stack}>
                    {/* Order management (doc 17, O6) — assignee /
                        priority / tags / hold / internal notes;
                        self-fetches by order id. */}
                    <ManagementPanel orderId={order.id} />
                    {/* Order editing (doc 17, O6) — line edits with
                        transactional stock deltas; self-fetches by
                        order id. */}
                    <EditPanel orderId={order.id} />
                  </div>
                ),
              },
              {
                id: "history",
                label: "ইতিহাস",
                count: timelineEntries.length,
                // Timeline v2 — typed entries built only from the
                // payload's history + notes streams (see
                // workspace-timeline.ts); StatusTimeline renders
                // its own empty state when there are none.
                content: <StatusTimeline history={order.history} entries={timelineEntries} />,
              },
            ]}
          />
        </div>
      </div>

      <p className="mt-5 text-caption text-text-subtle">
        ডেটা উৎস: অ্যাডমিন অর্ডার API (ডাটাবেস) — স্ট্যাটাস বদল PATCH দিয়ে ডাটাবেসে সেভ হয়।
      </p>
    </main>
  );
}
