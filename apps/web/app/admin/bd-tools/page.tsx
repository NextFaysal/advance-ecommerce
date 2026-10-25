/**
 * Admin > BD Tools — Agent 41 (BD differentiators E1/E2/E4 UI);
 * real data wiring completed 2026-10-25.
 *
 * One page, six tools:
 *  1. ঠিকানা পার্সার   — parseAddress() on staff-typed text (client panel;
 *     the prefilled text is example INPUT for trying the tool, not data)
 *  2. SMS যাচাই        — parseMerchantSms() on pasted SMS (client panel;
 *     same example-input note)
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
 *     in ./courier-stats.ts (history from the Shipment tables,
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
import { PaymentLinksPanel } from "./payment-links-panel";
import { CashClosingPanel, type StoredClosingView } from "./cash-closing-panel";
import { CourierAssignmentPanel } from "./courier-assignment-panel";
import { buildCourierStatsFromDb } from "./courier-stats";
import type { PaymentLinkListItemView } from "./actions";
import {
  RECONCILIATION_STATUS_LABELS_BN,
  reconciliationReasonBn,
} from "./labels";

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

function CourierReconciliationPanel({ run, openDisputes }: { run: CourierInvoiceRun | null; openDisputes: number }) {
  if (!run) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">
          এখনো কোনো কুরিয়ার ইনভয়েস রান সংরক্ষিত হয়নি। কুরিয়ারের ইনভয়েস CSV ইমপোর্ট হলে
          (courier-invoice API দিয়ে) রানটি <span className="font-mono text-xs">courier_invoice_runs</span>{" "}
          টেবিলে জমা থাকে এবং সর্বশেষ রানের মিল/বিবাদ এখানে দেখা যায় — মিলে যাওয়া টাকা আর বিবাদযুক্ত
          টাকা সবসময় আলাদা রাখা হয়, বিবাদযুক্ত সারির আমাদের প্রত্যাশিত মান কখনো ইনভয়েস অনুযায়ী
          বদলানো হয় না।
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
    status: <Badge tone="danger">{RECONCILIATION_STATUS_LABELS_BN[r.status]}</Badge>,
    expected: r.expectedPayablePoisha !== null ? <Money poisha={r.expectedPayablePoisha} /> : "—",
    invoiced: r.invoicedPayablePoisha !== null ? <Money poisha={r.invoicedPayablePoisha} /> : "—",
    difference: r.differencePoisha !== null ? <Money poisha={r.differencePoisha} /> : "—",
    reason: (
      <span className="text-xs">
        {r.disputeReasons.map((reason) => (
          <span key={reason} className="block">
            {reconciliationReasonBn(reason)}{" "}
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
          সর্বশেষ সংরক্ষিত রান — কুরিয়ার: {run.courierKey} · ইমপোর্ট: {run.importedAt.slice(0, 16).replace("T", " ")}
        </Badge>
        <span className="text-sm text-text-muted">
          মোট সারি {run.totalRows} · বৈধ {run.validRowCount} · খোলা বিবাদ (সব রান মিলিয়ে): {openDisputes}টি।
          মিলে যাওয়া টাকা আর বিবাদযুক্ত টাকা সবসময় আলাদা — বিবাদযুক্ত সারির আমাদের প্রত্যাশিত মান কখনো ইনভয়েস অনুযায়ী বদলানো হয় না।
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মিলেছে — পরিশোধযোগ্য" value={String(summary.matchedCount)} delta="এই রানে" icon={<Icon name="check" size={22} />} />
        <StatCard label="বিবাদযুক্ত সারি" value={String(summary.disputedCount)} delta="এই রানে" deltaTone="down" icon={<Icon name="alert" size={22} />} accent="bg-rose-50 text-rose-600" />
        <StatCard label="ইনভয়েসে নেই / অতিরিক্ত" value={`${summary.missingCount} / ${summary.extraCount}`} delta="এই রানে" icon={<Icon name="package" size={22} />} />
        <StatCard label="মোট প্রত্যাশিত (আমাদের)" value={formatPoisha(summary.expectedTotalPoisha)} delta="এই রানে" icon={<Icon name="banknote" size={22} />} />
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-800">মিলে যাওয়া মোট — নিরাপদে পরিশোধ করা যায়</p>
          <p className="mt-1 text-emerald-900"><Money poisha={summary.matchedTotalPoisha} /></p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-800">বিবাদযুক্ত মোট — আটকে রাখা হয়েছে, নিজে থেকে সমন্বয় হয়নি</p>
          <p className="mt-1 text-rose-900"><Money poisha={summary.disputedTotalPoisha} /></p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">বিবাদযুক্ত সারি (আমাদের আসল প্রত্যাশিত মানসহ)</h3>
        {disputedRows.length > 0 ? (
          <DataTable
            columns={[
              { key: "shipment", header: "শিপমেন্ট" },
              { key: "order", header: "অর্ডার" },
              { key: "provider", header: "কুরিয়ার" },
              { key: "status", header: "অবস্থা" },
              { key: "expected", header: "আমাদের প্রত্যাশিত" },
              { key: "invoiced", header: "ইনভয়েসে" },
              { key: "difference", header: "পার্থক্য" },
              { key: "reason", header: "কারণ" },
            ]}
            rows={disputedRows}
          />
        ) : (
          <p className="text-sm text-text-muted">এই রানে কোনো বিবাদযুক্ত সারি নেই।</p>
        )}
      </div>

      {matchedRows.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold">মিলে যাওয়া সারি</h3>
          <DataTable
            columns={[
              { key: "shipment", header: "শিপমেন্ট" },
              { key: "order", header: "অর্ডার" },
              { key: "provider", header: "কুরিয়ার" },
              { key: "payable", header: "পরিশোধযোগ্য" },
            ]}
            rows={matchedRows}
          />
        </div>
      ) : null}
    </div>
  );
}

export default async function BdToolsPage() {
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
        title="বিডি টুলস"
        description="বাংলাদেশের জন্য বিশেষ টুল — ঠিকানা পার্সার, SMS যাচাই, পেমেন্ট লিংক, দৈনিক ক্যাশ ক্লোজিং, কুরিয়ার রিকনসিলিয়েশন ও অটো কুরিয়ার বাছাই। সব তথ্য ডাটাবেস থেকে; পার্সার দুটি স্টাফের লেখা টেক্সটে চলে (উদাহরণ ইনপুটসহ)।"
        breadcrumb="বিক্রয় / বিডি টুলস"
      />
      <Card>
        <Tabs
          tabs={[
            { id: "address", label: "ঠিকানা পার্সার", content: <AddressParserPanel /> },
            { id: "sms", label: "SMS যাচাই", content: <SmsVerifyPanel /> },
            { id: "payment-links", label: "পেমেন্ট লিংক", content: <PaymentLinksPanel initialLinks={links} /> },
            {
              id: "cash-closing",
              label: "ক্যাশ ক্লোজিং",
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
              label: "কুরিয়ার রিকনসিলিয়েশন",
              content: <CourierReconciliationPanel run={latestRun} openDisputes={openDisputes} />,
            },
            {
              id: "courier-assignment",
              label: "অটো কুরিয়ার বাছাই",
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
