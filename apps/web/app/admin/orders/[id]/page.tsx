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
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Customer, Order, OrderStatus } from "../../../../src/orders/types";
import { nextStepTarget, ORDER_TRANSITIONS } from "../../../../src/orders/state-machine";
import { displayPhone, riskLevel } from "../../../../src/orders/customer";
import { formatBdt } from "../../../../src/checkout/pricing";
import { lineTotalPoisha } from "../../../../src/lib/quantity";
import { CustomerSummaryCard } from "../../../../src/orders/components/CustomerSummaryCard";
import { OneClickPanel } from "../../../../src/orders/components/OneClickPanel";
import { PrintPanel } from "../../../../src/orders/components/PrintPanel";
import { RefundsPanel } from "./refunds-panel";
import { ShipmentsPanel } from "./shipments-panel";
import { PhoneReveal } from "./phone-reveal";
import { EditPanel } from "./edit-panel";
import { ManagementPanel } from "./management-panel";
import { WorkflowStagePanel } from "./workflow-stage-panel";
import { WorkflowStageChip } from "../../../../src/orders/components/WorkflowStageChip";
import { ReturnsPanel } from "./returns-panel";
import { AdvancePanel } from "./advance-panel";
import type { OrderAdvanceView } from "../../../../src/orders/advance";
import { StatusTimeline } from "../../../../src/orders/components/StatusTimeline";
import {
  OrderPaymentBadge,
  OrderStatusBadge,
} from "../../../../src/orders/components/OrderStatusBadge";
import {
  ORDER_STATUS_VISUAL,
  PAYMENT_STATUS_VISUAL,
} from "../../../../src/orders/components/labels";
import { interpolate, pick, type Locale } from "../../../../src/i18n/locale";
import { useLocale } from "../../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "../strings";
import { MoneyBreakdown } from "../../../../src/orders/components/MoneyBreakdown";
import { ORDER_DENSITY } from "../../../../src/orders/components/density";
import { orderAgeLabel, previewMoneyProps } from "../list-helpers";
import { buildWorkspaceTimelineEntries } from "./workspace-timeline";
import { RailAdvanceSummary } from "./rail-advance-summary";
import { ApprovalBanner } from "./approval-banner";
import { RailManagementSummary } from "./rail-management-summary";
import { PickupOtpPanel } from "./pickup-otp-panel";
import { CustomFieldsPanel } from "@/components/admin/custom-fields-panel";
import { PresenceHeartbeat } from "./presence-heartbeat";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tabs } from "@/components/ui/tabs";

type DetailOrder = Order & {
  advance?: OrderAdvanceView;
  /** ADV-23 rental (wave 56): the detail API's data.rental — the
   *  money card reads the frozen deposit from it (via
   *  previewMoneyProps) so the deposit prints as its own line. */
  rental?: {
    depositPoisha: number;
    startDate: string;
    endDate: string;
    days: number;
    status: string;
  } | null;
  /** ADV-23 vertical 5 (wave 56): the detail API's data.pod —
   *  present ONLY when the order carries a custom print (parsed
   *  from the create-time order note). The rail card below shows
   *  the print shop exactly what to print; the money card reads
   *  the frozen fee from it (via previewMoneyProps). */
  pod?: {
    variantId: string;
    productName: string | null;
    printText: string;
    printColor: string | null;
    feePerItemPoisha: number;
    quantity: number;
    feePoisha: number;
    printed: boolean;
  } | null;
  /** ADV-26 (BUILD-LITE): the detail API's data.workflowStage —
   *  present ONLY when a merchant stage is set on this order and
   *  module.workflow_stages is ON (src/orders/stages.ts). A label
   *  anchored at the canonical status; never a status itself. */
  workflowStage?: {
    stageId: string;
    labelBn: string;
    labelEn: string;
    tone: "brand" | "success" | "warning" | "danger" | "info" | "neutral";
    anchorStatus: string | null;
  } | null;
  approval?: {
    discount: {
      id: string;
      status: "PENDING" | "APPROVED" | "REJECTED";
      discountBps: number | null;
      thresholdBps: number | null;
      amountPoisha: number | null;
      decisionReason: string | null;
    } | null;
    pendingDiscount: boolean;
    refunds: {
      id: string;
      status: "PENDING" | "APPROVED" | "REJECTED";
      discountBps: number | null;
      thresholdBps: number | null;
      amountPoisha: number | null;
      decisionReason: string | null;
    }[];
  };
};

/**
 * Delivery-slot label (doc 17 batch O9-2): Order.deliverySlot stores
 * the slot ID from Settings orders.delivery_slots; the bilingual
 * label is display-time, resolved from the public slots endpoint.
 * Falls back to the raw id (a slot renamed/removed after the order
 * was placed still shows SOMETHING truthful, never a wrong label).
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

type DetailResponse =
  | { data: DetailOrder; meta?: unknown }
  | { error: { code: string; message: string } };

const PAYMENT_METHOD_LABEL: Record<string, Record<Locale, string>> = {
  cod: { bn: "ক্যাশ অন ডেলিভারি", en: "Cash on Delivery" },
  bkash: { bn: "বিকাশ", en: "bKash" },
  nagad: { bn: "নগদ", en: "Nagad" },
  rocket: { bn: "রকেট", en: "Rocket" },
  card: { bn: "কার্ড", en: "Card" },
  sslcommerz: { bn: "SSLCommerz", en: "SSLCommerz" },
};

/** Localized primary next-step label per TARGET status — the state
 *  machine's nextStepLabel (src/orders) is English-only, so the
 *  button text is resolved here from the target it computes. */
const NEXT_STEP_LABEL: Partial<Record<OrderStatus, Record<Locale, string>>> = {
  CONFIRMED: { bn: "কনফার্ম করুন", en: "Confirm" },
  PROCESSING: { bn: "প্রসেসিং শুরু করুন", en: "Start Processing" },
  PACKED: { bn: "প্যাকড হিসেবে চিহ্নিত করুন", en: "Mark Packed" },
  SHIPPED: { bn: "শিপ করুন", en: "Ship" },
  DELIVERED: { bn: "ডেলিভারি সম্পন্ন করুন", en: "Mark Delivered" },
  RETURN_REQUESTED: { bn: "রিটার্ন অনুরোধ করুন", en: "Request Return" },
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
  const router = useRouter();
  const { locale, t } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const localeRef = useRef(locale);
  localeRef.current = locale;
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
  // OD8 (doc 19 S8) — the "?" shortcut hint popover in the header.
  const [showShortcuts, setShowShortcuts] = useState(false);

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
      setLoadError(pick(localeRef.current, ORDER_STRINGS).networkApi);
      setLoadState("error");
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /* OD8 (doc 19 S8) — workspace keyboard shortcuts. Every key drives
   * an EXISTING handler only: tab jumps reuse the rail's tabSeed
   * re-seed, and "p" goes to the print centre URL the list/preview
   * already link to for one order. Guards: never while typing in an
   * input/textarea/select/contentEditable, never with a modifier held
   * (⌘K stays the palette's), never while a modal/drawer (role
   * dialog) is open. "?" toggles the hint popover in the header. */
  useEffect(() => {
    if (!order) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const t = event.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
      ) {
        return;
      }
      if (event.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const jump = (id: string) => setTabSeed((s) => ({ id, n: s.n + 1 }));
      switch (event.key.toLowerCase()) {
        case "?":
          setShowShortcuts((v) => !v);
          break;
        case "p":
          setShowShortcuts(false);
          router.push(`/admin/orders/print?ids=${order.id}`);
          break;
        case "a":
          setShowShortcuts(false);
          jump("actions");
          break;
        case "m":
          setShowShortcuts(false);
          jump("payment");
          break;
        case "s":
          setShowShortcuts(false);
          jump("shipments");
          break;
        case "r":
          setShowShortcuts(false);
          jump("returns");
          break;
        case "e":
          setShowShortcuts(false);
          jump("management");
          break;
        case "h":
          setShowShortcuts(false);
          jump("history");
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, router]);

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
        setOrder({ ...body.data, advance: order.advance, approval: order.approval });
        setMessage(interpolate(s.dtStatusChanged, { from: order.status, to }));
      } else if (body && "error" in body) {
        setMessage(
          interpolate(s.dtRejectedWith, {
            status: res.status,
            error: `${body.error.code}: ${body.error.message}`,
          }),
        );
      } else {
        setMessage(interpolate(s.dtRejectedHttp, { status: res.status }));
      }
    } catch {
      setMessage(s.dtTransitionNet);
    } finally {
      setBusy(false);
    }
  }

  if (loadState === "loading") {
    return (
      <main>
        <div role="status" aria-label={s.ordLoadingAria} className="rounded-2xl border border-border/60 bg-card p-6 shadow-xs">
          <div className="skeleton-shimmer h-6 w-48 rounded-md" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="skeleton-shimmer h-24 rounded-xl" />
            <div className="skeleton-shimmer h-24 rounded-xl" />
          </div>
          <p className="mt-4 text-small text-text-muted">{s.ordLoading}</p>
        </div>
      </main>
    );
  }
  if (loadState === "notfound") {
    return (
      <main>
        <EmptyState
          title={s.dtNotFoundTitle}
          description={interpolate(s.dtNotFoundBody, { id: params.id })}
        >
          <div className="mt-5">
            <a
              href="/admin/orders"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-border bg-card px-4 text-sm font-semibold shadow-xs transition duration-fast ease-smooth hover:bg-surface-2"
            >
              {s.dtBackBtn}
            </a>
          </div>
        </EmptyState>
      </main>
    );
  }
  if (loadState === "error" || !order) {
    return (
      <main>
        <div role="alert" className="rounded-2xl border border-danger/25 bg-danger-soft p-5 shadow-xs">
          <p className="font-semibold text-danger">{s.ordLoadFailTitle}</p>
          <p className="mt-1 text-small text-danger">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            {s.tryAgain}
          </Button>
        </div>
      </main>
    );
  }

  const nextTarget = nextStepTarget(order.status);
  const nextLabel = nextTarget ? NEXT_STEP_LABEL[nextTarget] : undefined;
  const level = riskLevel(order.riskScore);
  const addressLine = [order.address.addressLine, order.address.upazila, order.address.district, order.address.division]
    .filter(Boolean)
    .join(", ");
  const ageLabel = orderAgeLabel(order.createdAt, Date.now(), locale);
  const paymentKnown = (Object.keys(PAYMENT_STATUS_VISUAL) as string[]).includes(order.paymentStatus);
  const timelineEntries = buildWorkspaceTimelineEntries(order, locale);
  const stack = ORDER_DENSITY.comfortable.stack;
  const hasGift = order.giftMessage !== null && order.giftMessage !== undefined;
  const showDeliveryCard = Boolean(order.courier || order.trackingId || order.deliverySlot || hasGift);

  return (
    <main>
      <a href="/admin/orders" className="mb-4 inline-flex items-center gap-1.5 text-small font-medium text-text-muted transition duration-fast ease-smooth hover:text-brand-700">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
          <path d="m15 18-6-6 6-6" />
        </svg>
        {s.dtBackToList}
      </a>

      {/* Header band — order no, OD0 status language, age, total and
          the primary next-step affordance (the state machine's legal
          next transition; the full transition set + reason input live
          in the কাজ tab). */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate font-mono text-h2 font-bold">{order.orderNo}</h1>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <OrderStatusBadge status={order.status} lang={locale} />
              {order.workflowStage ? (
                <WorkflowStageChip
                  label={locale === "bn" ? order.workflowStage.labelBn : order.workflowStage.labelEn}
                  tone={order.workflowStage.tone}
                />
              ) : null}
              {paymentKnown ? (
                <OrderPaymentBadge status={order.paymentStatus} lang={locale} />
              ) : (
                <Badge tone="neutral">{order.paymentStatus}</Badge>
              )}
              <Badge tone="neutral">
                {PAYMENT_METHOD_LABEL[order.paymentMethod]
                  ? pick(locale, PAYMENT_METHOD_LABEL[order.paymentMethod])
                  : order.paymentMethod}
              </Badge>
              <Badge tone={level === "High" ? "danger" : level === "Medium" ? "warning" : "success"}>
                {interpolate(s.dtRisk, {
                  level:
                    level === "High" ? s.riskWordHigh : level === "Medium" ? s.riskWordMedium : s.riskWordLow,
                  score: order.riskScore,
                })}
              </Badge>
              {ageLabel ? (
                <Badge tone="neutral" icon={<Icon name="clock" size={12} />}>
                  {ageLabel}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2.5 text-small leading-relaxed text-text-muted">
              {s.dtCustomerPrefix} <span className="font-medium text-text-main">{order.customerName}</span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-caption font-medium text-text-muted">{t.total}</p>
            <p className="tnum text-h1 font-bold">{formatBdt(order.totalPoisha)}</p>
            {nextLabel && nextTarget && (
              <Button
                variant="gradient"
                className="mt-3"
                disabled={busy}
                onClick={() => void applyTransition(nextTarget)}
              >
                {pick(locale, nextLabel)}
              </Button>
            )}
            {/* OD8 — keyboard shortcut hint ("?" toggles; the keys
                themselves are wired in the effect above). */}
            <div className="relative mt-3">
              <button
                type="button"
                aria-label={s.dtShortcutsAria}
                aria-expanded={showShortcuts}
                onClick={() => setShowShortcuts((v) => !v)}
                className="inline-flex items-center gap-1.5 text-caption font-medium text-text-muted transition duration-fast ease-smooth hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
              >
                <span aria-hidden="true" className="flex h-5 w-5 items-center justify-center rounded-full border border-border font-mono text-[11px] font-bold">?</span>
                {s.dtShortcuts}
              </button>
              {showShortcuts ? (
                <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-2xl border border-border/60 bg-card p-3.5 text-left shadow-pop">
                  <p className="text-small font-semibold">{s.dtShortcuts}</p>
                  <ul className="mt-2 space-y-1.5 text-small text-text-muted">
                    {[
                      ["P", s.scPrint],
                      ["E", s.scManagement],
                      ["A", s.scActions],
                      ["M", s.scPayment],
                      ["S", s.scShipments],
                      ["R", s.scReturns],
                      ["H", s.scHistory],
                      ["⌘K", s.scSearch],
                      ["?", s.scToggle],
                    ].map(([key, label]) => (
                      <li key={key} className="flex items-center justify-between gap-3">
                        <span>{label}</span>
                        <kbd className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption font-medium text-text-main">
                          {key}
                        </kbd>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 border-t border-border pt-2 text-caption leading-relaxed text-text-subtle">
                    {s.dtShortcutsNote}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      {/* Transition result — shown under the header so it is visible
          from whichever tab (or the header button) triggered it. */}
      {message && (
        <p role="status" className="mb-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-small leading-relaxed">
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
          <Card>
            <h2 className="mb-3 text-base font-semibold">{s.dtContactTitle}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-text-muted">{t.phone}</dt>
                <dd>
                  <PhoneReveal orderId={order.id} maskedPhone={displayPhone(order.customerPhone, false)} />
                </dd>
              </div>
              {addressLine ? (
                <div>
                  <dt className="text-text-muted">{t.address}</dt>
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
                  {s.dtProfileLink}
                </a>
                {customer ? "" : s.dtProfileNoteSuffix}
              </p>
            )}
          </Card>

          {/* Money — OD0 MoneyBreakdown fed exactly as the OD1
              preview feeds it (subtotal from items, doc-18 split
              passthrough, paid from the advance read model). */}
          <Card>
            <h2 className="mb-3 text-base font-semibold">{s.dtMoneyTitle}</h2>
            <MoneyBreakdown {...previewMoneyProps(order)} lang={locale} />
          </Card>

          {/* Custom print (ADV-23 vertical 5) — renders only when
              the order carries a POD customisation (data.pod): the
              exact text + colour the print shop must print, frozen
              at order time on the order note. The printed state is
              the staff attestation from the print queue. */}
          {order.pod ? (
            <Card>
              <h2 className="mb-3 text-base font-semibold">{s.dtPodTitle}</h2>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-text-muted">{s.dtPodText}</dt>
                  <dd className="mt-0.5 text-base font-bold leading-relaxed">
                    «{order.pod.printText}»
                  </dd>
                </div>
                {order.pod.printColor ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">{s.dtPodColor}</dt>
                    <dd className="font-medium">{order.pod.printColor}</dd>
                  </div>
                ) : null}
                {order.pod.productName ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">{s.prodWord}</dt>
                    <dd className="font-medium">
                      {order.pod.productName} × {order.pod.quantity}
                    </dd>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-text-muted">{s.status}</dt>
                  <dd className="font-medium">
                    {order.pod.printed ? s.dtPodPrinted : s.dtPodPending}
                  </dd>
                </div>
              </dl>
            </Card>
          ) : null}

          {/* Advance state summary — renders nothing for ordinary
              orders (same condition as AdvancePanel). */}
          <RailAdvanceSummary
            advance={order.advance}
            onShowPayments={() => setTabSeed((s) => ({ id: "payment", n: s.n + 1 }))}
          />

          {/* Approval state (ADV-27) — renders nothing unless a
              discount/refund approval record exists for this order;
              a pending one names the block before staff hit it. */}
          <ApprovalBanner approval={order.approval} />

          {/* Delivery — courier / tracking / slot + gift chips. */}
          {showDeliveryCard ? (
            <Card>
              <h2 className="mb-3 text-base font-semibold">{s.dtDeliveryTitle}</h2>
              <dl className="space-y-2 text-sm">
                {order.courier ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">{s.colCourier}</dt>
                    <dd className="font-medium">{order.courier}</dd>
                  </div>
                ) : null}
                {order.trackingId ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">{s.dtTracking}</dt>
                    <dd className="font-mono">{order.trackingId}</dd>
                  </div>
                ) : null}
                {order.deliverySlot ? (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-text-muted">{s.dtSlot}</dt>
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
                      <dt className="text-text-muted">{s.prevGift}</dt>
                      <dd>
                        <Badge tone="brand" icon={<Icon name="sparkles" size={12} />}>
                          {s.dtGiftSend}
                        </Badge>
                      </dd>
                    </div>
                    <p className="mt-1.5 leading-relaxed text-text-muted">
                      {order.giftMessage ? (
                        <>{s.dtGiftMsgPrefix} <span className="font-medium text-text-main">“{order.giftMessage}”</span></>
                      ) : (
                        s.dtGiftNoMsg
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

          {/* Pickup OTP (ADV-19 remainder) — self-fetching; renders
              nothing for non-pickup orders. For pickup orders it is
              the verify/resend surface that unlocks the DELIVERED
              transition (blocked server-side until verified). */}
          <PickupOtpPanel orderId={order.id} />

          {/* Merchant custom fields (ADV-26, wave 53) — self-fetching;
              renders nothing until order fields are defined in
              /admin/webhooks, so the rail is unchanged by default. */}
          <CustomFieldsPanel entity="order" entityId={order.id} />

          {/* Presence + edit-conflict warning (ADV-27 remainder) —
              heartbeats this order's path and shows an amber warning
              naming any OTHER staff currently viewing the order.
              Warning only; renders nothing when nobody else is here. */}
          <PresenceHeartbeat orderId={order.id} />
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
                label: s.tabActions,
                content: (
                  <div className={stack}>
                    {/* Items */}
                    <Card>
                      <SectionTitle>{interpolate(s.dtItemsTitle, { n: order.items.length })}</SectionTitle>
                      <ul className="divide-y divide-border">
                        {order.items.map((i) => (
                          <li key={i.variantId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                            <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-brand-500">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                                <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
                                <path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />
                              </svg>
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium leading-snug">{i.productName}</p>
                              <p className="font-mono text-caption text-text-muted">{i.sku} × {i.quantity}</p>
                            </div>
                            <p className="tnum font-semibold">{formatBdt(lineTotalPoisha(i.unitPricePoisha, i.quantity))}</p>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-4 flex items-center justify-between border-t border-border pt-3.5">
                        <span className="font-semibold">{s.totalWord}</span>
                        <span className="tnum text-h3 font-bold">{formatBdt(order.totalPoisha)}</span>
                      </div>
                    </Card>

                    {/* Status actions — the full legal transition set
                        with the reason input (the primary next step
                        also sits in the header). */}
                    <Card>
                      <SectionTitle sub={s.dtStatusChangeSub}>
                        {s.dtStatusChangeTitle}
                      </SectionTitle>
                      <label className="mb-1.5 block text-small font-medium" htmlFor="transition-reason">
                        {s.dtReasonLabel}
                      </label>
                      <input
                        id="transition-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={s.dtReasonPlaceholder}
                        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15"
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
                            {interpolate(s.dtTransitionBtn, {
                              label:
                                locale === "bn"
                                  ? ORDER_STATUS_VISUAL[to].labelBn
                                  : ORDER_STATUS_VISUAL[to].labelEn,
                            })}
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
                label: s.tabPayment,
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
                label: s.tabShipments,
                // Shipments (doc 17, O5) — bookings incl. split
                // parcels; self-fetches by order id.
                content: <ShipmentsPanel orderId={order.id} />,
              },
              {
                id: "returns",
                label: s.tabReturns,
                // Returns / RMA (doc 17, O7) — self-fetches by
                // order id.
                content: <ReturnsPanel orderId={order.id} />,
              },
              {
                id: "management",
                label: s.tabManagement,
                content: (
                  <div className={stack}>
                    {/* Order management (doc 17, O6) — assignee /
                        priority / tags / hold / internal notes;
                        self-fetches by order id. */}
                    <ManagementPanel orderId={order.id} />
                    {/* Workflow stage (ADV-26, BUILD-LITE) — the
                        merchant stage picker; self-fetches by order
                        id, renders nothing while the add-on is OFF,
                        and reloads the workspace after a change so
                        the header chip stays truthful. */}
                    <WorkflowStagePanel orderId={order.id} onChanged={() => void load()} />
                    {/* Order editing (doc 17, O6) — line edits with
                        transactional stock deltas; self-fetches by
                        order id. */}
                    <EditPanel orderId={order.id} />
                  </div>
                ),
              },
              {
                id: "history",
                label: s.tabHistory,
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
        {s.dtDataSource}
      </p>
    </main>
  );
}
