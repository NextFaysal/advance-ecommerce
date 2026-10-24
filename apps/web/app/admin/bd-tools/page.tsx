/**
 * Admin > BD Tools — Agent 41 (BD differentiators E1/E2/E4 UI).
 *
 * One page, five tools, all running the REAL pure functions from
 * src/bd/* (Agent 11) — this page adds no business logic of its own:
 *  1. ঠিকানা পার্সার   — parseAddress() (client panel)
 *  2. SMS যাচাই        — parseMerchantSms() (client panel)
 *  3. পেমেন্ট লিংক     — createPaymentLink() via server action (./actions.ts)
 *  4. ক্যাশ ক্লোজিং    — buildDailyCashClosing() over TEMPORARY DEMO rows
 *  5. কুরিয়ার রিকনসিলিয়েশন — reconcileCourierInvoice() over TEMPORARY DEMO rows
 *
 * The matching API route groups already exist under
 * app/api/v1/admin/bd/* (address-parse, sms-verify, payment-links,
 * cash-closing, courier-reconciliation) — Agent 34's audit flagged bd
 * as API-only; this page closes that gap.
 *
 * Demo honesty: cash-closing + reconciliation panels are computed from
 * the SAMPLE inputs in ./demo-data.ts and labelled TEMPORARY DEMO.
 * Payment links use the shared DB-backed store (payment_links table —
 * the same store /pay/[token] resolves against); the list below is
 * built server-side and only the token-hash PREFIX ever reaches the
 * browser.
 */
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { Tabs } from "@/components/ui/tabs";
import { buildDailyCashClosing } from "@/bd/cash-closing";
import { reconcileCourierInvoice } from "@/bd/courier-reconciliation";
import { paymentLinkStore, withEffectiveStatus } from "@/bd/payment-link";
import { ensureDemoPaymentLink } from "@/storefront-ux/pay-link-view";
import { AddressParserPanel } from "./address-parser-panel";
import { SmsVerifyPanel } from "./sms-verify-panel";
import { PaymentLinksPanel } from "./payment-links-panel";
import { CourierAssignmentPanel } from "./courier-assignment-panel";
import type { PaymentLinkListItemView } from "./actions";
import {
  DEMO_CASH_CLOSING_INPUT,
  DEMO_EXPECTED_SHIPMENTS,
  DEMO_INVOICE_ROWS,
} from "./demo-data";
import {
  CHANNEL_LABELS_BN,
  RECONCILIATION_STATUS_LABELS_BN,
  formatDateBn,
  reconciliationReasonBn,
} from "./labels";

/** Server-side only: maps store records to the browser-safe list view
 *  (hash prefix, never the full hash, never a token). */
async function initialPaymentLinks(): Promise<PaymentLinkListItemView[]> {
  await ensureDemoPaymentLink();
  const records = await paymentLinkStore.listByOrder("ORD-100244");
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

function CashClosingPanel() {
  const closing = buildDailyCashClosing(DEMO_CASH_CLOSING_INPUT);
  const rows = closing.channels.map((c) => ({
    channel: CHANNEL_LABELS_BN[c.channel],
    expected: <Money poisha={c.expectedPoisha} />,
    actual: <Money poisha={c.actualPoisha} />,
    difference: <Money poisha={c.differencePoisha} />,
    status: c.mismatch ? (
      <Badge tone="danger">⚠ অমিল আছে</Badge>
    ) : (
      <Badge tone="success">✓ মিলেছে</Badge>
    ),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">দিন: {formatDateBn(closing.date)}</h3>
        {closing.hasMismatch ? (
          <Badge tone="danger">⚠ অমিল আছে — চ্যানেল: {closing.mismatchChannels.map((c) => CHANNEL_LABELS_BN[c]).join(", ")}</Badge>
        ) : (
          <Badge tone="success">✓ সব চ্যানেল মিলেছে</Badge>
        )}
        <Badge tone="neutral">TEMPORARY DEMO — নমুনা দিনের হিসাব</Badge>
      </div>
      <DataTable
        columns={[
          { key: "channel", header: "চ্যানেল" },
          { key: "expected", header: "থাকার কথা (Expected)" },
          { key: "actual", header: "আসলে আছে (Actual)" },
          { key: "difference", header: "পার্থক্য" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={rows}
      />
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs text-text-muted">সর্বমোট থাকার কথা</p>
          <p className="mt-1"><Money poisha={closing.totalExpectedPoisha} /></p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs text-text-muted">সর্বমোট আসলে আছে</p>
          <p className="mt-1"><Money poisha={closing.totalActualPoisha} /></p>
        </div>
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <p className="text-xs text-text-muted">সর্বমোট পার্থক্য</p>
          <p className="mt-1"><Money poisha={closing.totalDifferencePoisha} /></p>
        </div>
      </div>
      <p className="text-sm text-text-muted">
        মেমো: গ্রাহকের খাতায় বকেয়া <Money poisha={closing.customerDuePoisha} /> — এটি হাতে থাকা টাকা নয়, তাই কোনো মোটে যোগ হয়নি।
        অমিল কখনো নিজে থেকে ঠিক করা হয় না — হিসাবরক্ষককে জানিয়ে কারণ খুঁজতে হয়। আসল দিনের ক্লোজিং জমা হয়
        cash-closing API দিয়ে (RBAC: reports.accounting); এই প্যানেলের সংখ্যা নমুনা ইনপুট থেকে আসল{" "}
        <span className="font-mono text-xs">buildDailyCashClosing()</span> দিয়ে হিসাব করা।
      </p>
    </div>
  );
}

function CourierReconciliationPanel() {
  const recon = reconcileCourierInvoice(DEMO_EXPECTED_SHIPMENTS, DEMO_INVOICE_ROWS);
  const disputed = recon.rows.filter((r) => r.disputed);
  const matched = recon.rows.filter((r) => !r.disputed);

  const disputedRows = disputed.map((r) => ({
    shipment: <span className="font-mono text-xs">{r.shipmentId}</span>,
    order: r.orderId ? <span className="font-mono text-xs">{r.orderId}</span> : "—",
    provider: r.provider ?? "—",
    status: <Badge tone="danger">⚠ {RECONCILIATION_STATUS_LABELS_BN[r.status]}</Badge>,
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
        <Badge tone="neutral">TEMPORARY DEMO — নমুনা ইনভয়েস রান</Badge>
        <span className="text-sm text-text-muted">
          মিলে যাওয়া টাকা আর বিবাদযুক্ত টাকা সবসময় আলাদা — বিবাদযুক্ত সারির আমাদের প্রত্যাশিত মান কখনো ইনভয়েস অনুযায়ী বদলানো হয় না।
        </span>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মিলেছে — পরিশোধযোগ্য" value={String(recon.summary.matchedCount)} delta="ডেমো" icon="✓" />
        <StatCard label="বিবাদযুক্ত সারি" value={String(recon.summary.disputedCount)} delta="ডেমো" deltaTone="down" icon="⚠" accent="bg-rose-50 text-rose-600" />
        <StatCard label="ইনভয়েসে নেই / অতিরিক্ত" value={`${recon.summary.missingCount} / ${recon.summary.extraCount}`} delta="ডেমো" icon="▣" />
        <StatCard label="মোট প্রত্যাশিত (আমাদের)" value={formatPoisha(recon.summary.expectedTotalPoisha)} delta="ডেমো" icon="৳" />
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs text-emerald-800">মিলে যাওয়া মোট — নিরাপদে পরিশোধ করা যায়</p>
          <p className="mt-1 text-emerald-900"><Money poisha={recon.summary.matchedTotalPoisha} /></p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-xs text-rose-800">বিবাদযুক্ত মোট — আটকে রাখা হয়েছে, নিজে থেকে সমন্বয় হয়নি</p>
          <p className="mt-1 text-rose-900"><Money poisha={recon.summary.disputedTotalPoisha} /></p>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">বিবাদযুক্ত সারি (আমাদের আসল প্রত্যাশিত মানসহ)</h3>
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
  return (
    <div className="space-y-6">
      <PageHeader
        title="বিডি টুলস"
        description="বাংলাদেশের জন্য বিশেষ টুল — ঠিকানা পার্সার, SMS যাচাই, পেমেন্ট লিংক, দৈনিক ক্যাশ ক্লোজিং ও কুরিয়ার রিকনসিলিয়েশন। সব হিসাব src/bd-এর আসল সার্ভিস দিয়ে হয়; ডেমো ডেটা যেখানে আছে তা স্পষ্টভাবে লেখা আছে।"
        breadcrumb="বিক্রয় / বিডি টুলস"
      />
      <Card>
        <Tabs
          tabs={[
            { id: "address", label: "ঠিকানা পার্সার", content: <AddressParserPanel /> },
            { id: "sms", label: "SMS যাচাই", content: <SmsVerifyPanel /> },
            { id: "payment-links", label: "পেমেন্ট লিংক", content: <PaymentLinksPanel initialLinks={await initialPaymentLinks()} /> },
            { id: "cash-closing", label: "ক্যাশ ক্লোজিং", content: <CashClosingPanel /> },
            { id: "courier-reconciliation", label: "কুরিয়ার রিকনসিলিয়েশন", content: <CourierReconciliationPanel /> },
            { id: "courier-assignment", label: "অটো কুরিয়ার বাছাই", content: <CourierAssignmentPanel /> },
          ]}
        />
      </Card>
    </div>
  );
}
