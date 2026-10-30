/**
 * Admin > BD Tools — Agent 41 (BD differentiators E1/E2/E4 UI);
 * real data wiring completed 2026-10-25.
 *
 * One page, seven tools:
 *  1. ঠিকানা পার্সার   — parseAddress() on staff-typed text (client panel;
 *     the prefilled text is example INPUT for trying the tool, not data)
 *  2. SMS যাচাই        — parseMerchantSms() on pasted SMS (client panel;
 *     same example-input note)
 *  2b. ডিভাইস টোকেন   — per-device tokens for the Android SMS
 *     forwarder (wave 58): provisioned here, hashes only at rest
 *     (src/bd/devices.ts); the ingest route accepts them as
 *     `Authorization: Bearer ae_dev_…` in place of a staff session
 *  3. পেমেন্ট লিংক     — DB-backed paymentLinkStore (payment_links table);
 *     the list is the newest real links across all orders (listRecent) —
 *     no demo link is seeded for this page any more
 *  4. ক্যাশ ক্লোজিং    — the cash expectation is DERIVED from the
 *     day's records server-side (deriveDrawerCash: POS cash sales +
 *     rider COD hand-ins − cash refunds SENT); staff enter only the
 *     physical counts in the client panel; POST
 *     /api/v1/admin/bd/cash-closing computes with
 *     buildDailyCashClosing() and persists to daily_cash_closings;
 *     saved closings are read back below the form
 *  5. কুরিয়ার রিকনসিলিয়েশন — the latest PERSISTED invoice run from
 *     src/bd/courier-invoice.ts (courier_invoice_runs table) plus the
 *     open disputes list; no run imported yet -> honest empty state
 *  6. অটো কুরিয়ার বাছাই — assignCourier() over stats built server-side
 *     in src/bd/courier-stats-db.ts (history from the Shipment tables,
 *     capabilities from the provider catalogue)
 *
 * The matching API route groups live under app/api/v1/admin/bd/*.
 * Only the payment token-hash PREFIX ever reaches the browser.
 */
import { prisma } from "@advance-ecommerce/db";
import { PageHeader } from "@/admin-shell/PageHeader";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/ui/empty-state";
import { paymentLinkStore, withEffectiveStatus } from "@/bd/payment-link";
import { deriveDrawerCash } from "@/bd/cash-closing-derive";
import { listDisputes, listInvoiceRuns, type CourierInvoiceRun } from "@/bd/courier-invoice";
import { listAttempts } from "@/integrations/sandbox/db-store";
import nextDynamic from "next/dynamic";
import { AddressParserPanel } from "./address-parser-panel";
import type { StoredClosingView } from "./cash-closing-panel";
import { PanelSkeleton } from "./panel-skeleton";

// Lazy tab panels (admin perf wave, audit B2): this route's page chunk
// was the heaviest in the admin (109 kB) because all six client panels
// shipped eagerly. Only the DEFAULT tab (address — Tabs falls back to
// tabs[0], and this page passes no defaultId) stays a static import:
// it is what renders on first paint, so it must not flash a loader.
// The other five client panels load via next/dynamic; Tabs mounts
// only the active panel, so each panel's chunk now downloads on first
// switch to its tab, with PanelSkeleton in the panel area while it
// loads. The courier-reconciliation tab stays an inline server
// component (below) — it ships no panel JS of its own. No state is
// shared between panels (each receives its own server-computed props
// from this page and owns its internal state), so nothing else moves.
// (Aliased import: this module already exports the route-segment
// config `dynamic = "force-dynamic"`.)
const SmsVerifyPanel = nextDynamic(
  () => import("./sms-verify-panel").then((m) => m.SmsVerifyPanel),
  { loading: () => <PanelSkeleton /> },
);
const SmsDevicesPanel = nextDynamic(
  () => import("./sms-devices-panel").then((m) => m.SmsDevicesPanel),
  { loading: () => <PanelSkeleton /> },
);
const PaymentLinksPanel = nextDynamic(
  () => import("./payment-links-panel").then((m) => m.PaymentLinksPanel),
  { loading: () => <PanelSkeleton /> },
);
const CashClosingPanel = nextDynamic(
  () => import("./cash-closing-panel").then((m) => m.CashClosingPanel),
  { loading: () => <PanelSkeleton /> },
);
const CourierAssignmentPanel = nextDynamic(
  () => import("./courier-assignment-panel").then((m) => m.CourierAssignmentPanel),
  { loading: () => <PanelSkeleton /> },
);
const PhoneFraudCheckPanel = nextDynamic(
  () => import("./phone-fraud-check-panel").then((m) => m.PhoneFraudCheckPanel),
  { loading: () => <PanelSkeleton /> },
);
const ShippingLabelsPanel = nextDynamic(
  () => import("./shipping-labels-panel").then((m) => m.ShippingLabelsPanel),
  { loading: () => <PanelSkeleton /> },
);
const ReturnTrackerPanel = nextDynamic(
  () => import("./return-tracker-panel").then((m) => m.ReturnTrackerPanel),
  { loading: () => <PanelSkeleton /> },
);
const OrderSmsPanel = nextDynamic(
  () => import("./order-sms-panel").then((m) => m.OrderSmsPanel),
  { loading: () => <PanelSkeleton /> },
);
const WhatsAppRecoveryPanel = nextDynamic(
  () => import("./whatsapp-recovery-panel").then((m) => m.WhatsAppRecoveryPanel),
  { loading: () => <PanelSkeleton /> },
);
const ProfitCalculatorPanel = nextDynamic(
  () => import("./profit-calculator-panel").then((m) => m.ProfitCalculatorPanel),
  { loading: () => <PanelSkeleton /> },
);
const QrPaymentPanel = nextDynamic(
  () => import("./qr-payment-panel").then((m) => m.QrPaymentPanel),
  { loading: () => <PanelSkeleton /> },
);
const CourierCoveragePanel = nextDynamic(
  () => import("./courier-coverage-panel").then((m) => m.CourierCoveragePanel),
  { loading: () => <PanelSkeleton /> },
);
const CourierDisputeClaimPanel = nextDynamic(
  () => import("./courier-dispute-claim-panel").then((m) => m.CourierDisputeClaimPanel),
  { loading: () => <PanelSkeleton /> },
);
const CourierReconciliationPanel = nextDynamic(
  () => import("./courier-reconciliation-panel").then((m) => m.CourierReconciliationPanel),
  { loading: () => <PanelSkeleton /> },
);
import { buildCourierStatsFromDb } from "@/bd/courier-stats-db";
import type { PaymentLinkListItemView } from "./actions";
import { reconciliationReason, reconciliationStatusLabels } from "./labels";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";

export const dynamic = "force-dynamic";

/** yyyy-mm-dd of an instant in the Asia/Dhaka business timezone. */
function dhakaYmd(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Server-side only: newest real payment links across all orders,
 *  mapped to the browser-safe view (hash prefix, never a token). */
async function initialPaymentLinks(): Promise<PaymentLinkListItemView[]> {
  const records = await paymentLinkStore.listRecent(20);
  return records.map((record) => {
    const effective = withEffectiveStatus(record);
    return {
      id: effective.id,
      orderId: effective.orderId,
      amountPoisha: effective.amountPoisha,
      purpose: effective.purpose,
      status: effective.status,
      tokenHashPrefix: effective.tokenHash.slice(0, 10),
      createdAt: effective.createdAt,
      expiresAt: effective.expiresAt,
      paidAt: effective.paidAt,
    };
  });
}

async function savedClosings(): Promise<StoredClosingView[]> {
  const rows = await prisma.dailyCashClosing.findMany({
    orderBy: { closingDate: "desc" },
    take: 14,
  });
  return rows.map((row) => ({
    date: row.closingDate.toISOString().slice(0, 10),
    hasMismatch: row.hasMismatch,
    totalDifferencePoisha: row.differencePoisha,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Today's recorded bKash/Nagad receipts (payment attempts) — an
 *  editable estimate for the closing form, never presented as exact. */
async function todaysRecordedReceipts(todayYmd: string) {
  const attempts = await listAttempts();
  let bkashExpectedPoisha = 0;
  let nagadExpectedPoisha = 0;
  for (const a of attempts) {
    if (dhakaYmd(a.createdAt) !== todayYmd) continue;
    if (a.method === "bkash") bkashExpectedPoisha += a.paidPoisha;
    else if (a.method === "nagad") nagadExpectedPoisha += a.paidPoisha;
  }
  return { bkashExpectedPoisha, nagadExpectedPoisha };
}

export default async function BdToolsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const todayYmd = dhakaYmd(new Date().toISOString());
  const [links, closings, suggested, runs, disputes, courierStats, initialDerived] = await Promise.all([
    initialPaymentLinks(),
    savedClosings(),
    todaysRecordedReceipts(todayYmd),
    listInvoiceRuns(),
    listDisputes(),
    buildCourierStatsFromDb(),
    deriveDrawerCash(todayYmd),
  ]);
  const latestRun =
    runs.length > 0
      ? runs.reduce((a, b) => (a.importedAt >= b.importedAt ? a : b))
      : null;
  const openDisputes = disputes.filter(
    (d) => d.status === "OPEN" || d.status === "EVIDENCE_ATTACHED" || d.status === "SUBMITTED",
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader title={s.pageTitle} subtitle={s.pageDescription} />
      <Card>
        <Tabs
          tabs={[
            { id: "address", label: s.tabAddress, content: <AddressParserPanel /> },
            { id: "fraud-lookup", label: s.tabFraudLookup, content: <PhoneFraudCheckPanel /> },
            { id: "shipping-labels", label: s.tabShippingLabels, content: <ShippingLabelsPanel /> },
            { id: "return-tracker", label: s.tabReturnTracker, content: <ReturnTrackerPanel /> },
            { id: "order-sms", label: s.tabOrderSms, content: <OrderSmsPanel /> },
            { id: "whatsapp-recovery", label: s.tabWhatsappRecovery, content: <WhatsAppRecoveryPanel /> },
            { id: "profit-calculator", label: s.tabProfitCalculator, content: <ProfitCalculatorPanel /> },
            { id: "qr-payment", label: s.tabQrPayment, content: <QrPaymentPanel /> },
            { id: "courier-coverage", label: s.tabCourierCoverage, content: <CourierCoveragePanel /> },
            { id: "courier-claims", label: s.tabCourierClaims, content: <CourierDisputeClaimPanel /> },


            { id: "sms", label: s.tabSms, content: <SmsVerifyPanel /> },
            { id: "sms-devices", label: s.tabDevices, content: <SmsDevicesPanel /> },
            { id: "payment-links", label: s.tabPaymentLinks, content: <PaymentLinksPanel initialLinks={links} /> },
            {
              id: "cash-closing",
              label: s.tabCashClosing,
              content: (
                <CashClosingPanel
                  todayYmd={todayYmd}
                  recentClosings={closings}
                  suggested={suggested}
                  initialDerived={initialDerived}
                />
              ),
            },
            {
              id: "courier-reconciliation",
              label: s.tabRecon,
              content: <CourierReconciliationPanel initialRun={latestRun} initialOpenDisputes={openDisputes} />,
            },
            {
              id: "courier-assignment",
              label: s.tabAssignment,
              content: (
                <CourierAssignmentPanel
                  stats={courierStats.stats}
                  shipmentCount={courierStats.shipmentCount}
                  providersWithHistory={courierStats.providersWithHistory}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
