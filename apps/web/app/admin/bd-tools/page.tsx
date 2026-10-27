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
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { Icon } from "@/components/ui/icon";
import { paymentLinkStore, withEffectiveStatus } from "@/bd/payment-link";
import { deriveDrawerCash } from "@/bd/cash-closing-derive";
import { listDisputes, listInvoiceRuns, type CourierInvoiceRun } from "@/bd/courier-invoice";
import { listAttempts } from "@/integrations/sandbox/db-store";
import { AddressParserPanel } from "./address-parser-panel";
import { SmsVerifyPanel } from "./sms-verify-panel";
import { SmsDevicesPanel } from "./sms-devices-panel";
import { PaymentLinksPanel } from "./payment-links-panel";
import { CashClosingPanel, type StoredClosingView } from "./cash-closing-panel";
import { CourierAssignmentPanel } from "./courier-assignment-panel";
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

function CourierReconciliationPanel({
  run,
  openDisputes,
  locale,
  s,
}: {
  run: CourierInvoiceRun | null;
  openDisputes: number;
  locale: Locale;
  s: BdToolsStrings;
}) {
  if (!run) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          {s.reconEmpty1}
          <span className="font-mono text-xs">courier_invoice_runs</span>
          {s.reconEmpty2}
        </p>
      </div>
    );
  }

  const disputed = run.rows.filter((r) => r.disputed);
  const matched = run.rows.filter((r) => !r.disputed);
  const summary = run.summary;

  const disputedRows = disputed.map((r) => ({
    shipment: <span className="font-mono text-xs">{r.shipmentId}</span>,
    order: r.orderId ? <span className="font-mono text-xs">{r.orderId}</span> : "—",
    provider: r.provider ?? "—",
    status: <Badge tone="danger">{reconciliationStatusLabels(locale)[r.status]}</Badge>,
    expected: r.expectedPayablePoisha !== null ? <Money poisha={r.expectedPayablePoisha} /> : "—",
    invoiced: r.invoicedPayablePoisha !== null ? <Money poisha={r.invoicedPayablePoisha} /> : "—",
    difference: r.differencePoisha !== null ? <Money poisha={r.differencePoisha} /> : "—",
    reason: (
      <span className="text-xs">
        {r.disputeReasons.map((reason) => (
          <span key={reason} className="block">
            {reconciliationReason(reason, locale)}{" "}
            <span className="font-mono text-text-muted">({reason})</span>
          </span>
        ))}
      </span>
    ),
  }));

  const matchedRows = matched.map((r) => ({
    shipment: <span className="font-mono text-xs">{r.shipmentId}</span>,
    order: r.orderId ? <span className="font-mono text-xs">{r.orderId}</span> : "—",
    provider: r.provider ?? "—",
    payable: r.expectedPayablePoisha !== null ? <Money poisha={r.expectedPayablePoisha} /> : "—",
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">
          {interpolate(s.reconRunBadge, {
            courier: run.courierKey,
            at: run.importedAt.slice(0, 16).replace("T", " "),
          })}
        </Badge>
        <span className="text-sm text-text-muted">
          {interpolate(s.reconSummaryText, { total: run.totalRows, valid: run.validRowCount, disputes: openDisputes })}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statMatched} value={String(summary.matchedCount)} delta={s.statDeltaThisRun} icon={<Icon name="check" size={22} />} />
        <StatCard label={s.statDisputed} value={String(summary.disputedCount)} delta={s.statDeltaThisRun} deltaTone="down" icon={<Icon name="alert" size={22} />} accent="bg-rose-50 text-rose-600" />
        <StatCard label={s.statMissingExtra} value={`${summary.missingCount} / ${summary.extraCount}`} delta={s.statDeltaThisRun} icon={<Icon name="package" size={22} />} />
        <StatCard label={s.statExpectedTotal} value={formatPoisha(summary.expectedTotalPoisha)} delta={s.statDeltaThisRun} icon={<Icon name="banknote" size={22} />} />
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-800">{s.matchedTotalLabel}</p>
          <p className="mt-1 text-emerald-900"><Money poisha={summary.matchedTotalPoisha} /></p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-800">{s.disputedTotalLabel}</p>
          <p className="mt-1 text-rose-900"><Money poisha={summary.disputedTotalPoisha} /></p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{s.disputedHeading}</h3>
        {disputedRows.length > 0 ? (
          <DataTable
            columns={[
              { key: "shipment", header: s.colShipment },
              { key: "order", header: s.colOrder },
              { key: "provider", header: s.colProvider },
              { key: "status", header: s.colStatus },
              { key: "expected", header: s.colExpected },
              { key: "invoiced", header: s.colInvoiced },
              { key: "difference", header: s.colDifference },
              { key: "reason", header: s.colReason },
            ]}
            rows={disputedRows}
          />
        ) : (
          <p className="text-sm text-text-muted">{s.noDisputed}</p>
        )}
      </div>

      {matchedRows.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">{s.matchedHeading}</h3>
          <DataTable
            columns={[
              { key: "shipment", header: s.colShipment },
              { key: "order", header: s.colOrder },
              { key: "provider", header: s.colProvider },
              { key: "payable", header: s.colPayable },
            ]}
            rows={matchedRows}
          />
        </div>
      ) : null}
    </div>
  );
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
      <PageHeader
        title={s.pageTitle}
        description={s.pageDescription}
        breadcrumb={s.pageBreadcrumb}
      />
      <Card>
        <Tabs
          tabs={[
            { id: "address", label: s.tabAddress, content: <AddressParserPanel /> },
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
              content: <CourierReconciliationPanel run={latestRun} openDisputes={openDisputes} locale={locale} s={s} />,
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
