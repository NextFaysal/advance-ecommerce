import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money, formatPoisha } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Icon } from "@/components/ui/icon";
import type { PaymentStatus } from "@/integrations/payment";
import {
  COURIER_LABELS_BN,
  DEMO_TODAY_YMD,
  demoCodSettlementRows,
  demoManualSubmissions,
  demoTransactions,
  dhakaTime,
  paymentMethodLabelBn,
  summarizeCodByProvider,
  summarizeTransactions,
  totalCodOutstandingPoisha,
} from "./demo-data";
import { ManualTrxReviewQueue } from "./review-queue";

// Admin > Payments — Agent 42 (gap found by Agent 34's audit: payment
// APIs existed but there was no /admin/payments page).
// TEMPORARY DEMO: every figure below is computed from SAMPLE records in
// ./demo-data.ts, shaped exactly like the real API contracts —
//   transactions  <- GET /api/v1/admin/payments/sandbox   (SandboxPaymentAttempt)
//   manual queue  <- GET /api/v1/admin/payments/manual-trx (ManualTrxSubmission)
//   COD panel     <- GET /api/v1/admin/payments/cod-settlement (CodSettlementRow)
// No gateway is called and nothing is persisted. After the DB wiring the
// page reads those endpoints; review decisions then go through
// POST /api/v1/admin/payments/manual-trx, not page state.
// Payment links + daily cash closing live in BD Tools — linked, not rebuilt.

const PAYMENT_STATUS_META: Record<
  PaymentStatus,
  { labelBn: string; labelEn: string; tone: "warning" | "info" | "success" | "danger" | "brand" }
> = {
  UNPAID: { labelBn: "অপরিশোধিত", labelEn: "UNPAID", tone: "warning" },
  PARTIAL: { labelBn: "আংশিক পরিশোধ", labelEn: "PARTIAL", tone: "info" },
  PAID: { labelBn: "পরিশোধিত", labelEn: "PAID", tone: "success" },
  FAILED: { labelBn: "ব্যর্থ", labelEn: "FAILED", tone: "danger" },
  REFUNDED: { labelBn: "ফেরত দেওয়া", labelEn: "REFUNDED", tone: "info" },
  PARTIALLY_REFUNDED: { labelBn: "আংশিক ফেরত", labelEn: "PARTIALLY_REFUNDED", tone: "brand" },
};

function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const s = PAYMENT_STATUS_META[status];
  return (
    <Badge tone={s.tone}>
      {s.labelBn} ({s.labelEn})
    </Badge>
  );
}

export default function PaymentsPage() {
  const txSummary = summarizeTransactions(demoTransactions, DEMO_TODAY_YMD);
  const pendingManualCount = demoManualSubmissions.filter((s) => s.status === "pending").length;
  const codOutstanding = totalCodOutstandingPoisha(demoCodSettlementRows);
  const codSummaries = summarizeCodByProvider(demoCodSettlementRows);
  const disputedRows = demoCodSettlementRows.filter((r) => r.status === "disputed");

  const transactionRows = demoTransactions.map((t) => ({
    order: <span className="font-mono tabular-nums">#{t.orderId}</span>,
    method: paymentMethodLabelBn(t.method),
    amount: <Money poisha={t.amountPoisha} />,
    paid: <Money poisha={t.paidPoisha} />,
    status: <PaymentStatusBadge status={t.status} />,
    trx: t.gatewayTransactionId ? (
      <span className="font-mono text-xs tabular-nums">{t.gatewayTransactionId}</span>
    ) : (
      "—"
    ),
    time: <span className="font-mono tabular-nums">{dhakaTime(t.createdAt)}</span>,
  }));

  const codRows = codSummaries.map((s) => ({
    courier: COURIER_LABELS_BN[s.provider],
    shipments: String(s.shipmentCount),
    collected: <Money poisha={s.collectedPoisha} />,
    charge: <Money poisha={s.courierChargePoisha} />,
    outstanding: <Money poisha={s.outstandingPoisha} />,
    settled: <Money poisha={s.settledPoisha} />,
    disputed:
      s.disputedPoisha > 0 ? (
        <span className="inline-flex items-center gap-1 font-medium text-rose-700">
          <Icon name="alert" size={14} /> <Money poisha={s.disputedPoisha} />
        </span>
      ) : (
        "—"
      ),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="পেমেন্ট"
        description="TEMPORARY DEMO — নমুনা ডেটা, আসল API contract-এর আকারে। কোনো গেটওয়ে কল হয় না, কিছুই সংরক্ষিত হয় না।"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="আজ সংগৃহীত (ডেমো)"
          value={formatPoisha(txSummary.collectedTodayPoisha)}
          delta="আজ, Asia/Dhaka"
          icon={<Icon name="banknote" size={22} />}
        />
        <StatCard
          label="ম্যানুয়াল যাচাই বাকি"
          value={String(pendingManualCount)}
          delta="TrxID কিউ"
          deltaTone={pendingManualCount > 0 ? "down" : "up"}
          icon={<Icon name="clock" size={22} />}
        />
        <StatCard
          label="COD বকেয়া (কুরিয়ারের কাছে)"
          value={formatPoisha(codOutstanding)}
          delta="pending সেটেলমেন্ট"
          icon={<Icon name="truck" size={22} />}
        />
        <StatCard
          label="আজ ফেরত (ডেমো)"
          value={formatPoisha(txSummary.refundedTodayPoisha)}
          delta="আজ, Asia/Dhaka"
          deltaTone="down"
          icon={<Icon name="rotate-ccw" size={22} />}
        />
      </div>

      <DataTable
        caption="লেনদেন — নমুনা (TEMPORARY DEMO)"
        columns={[
          { key: "order", header: "অর্ডার" },
          { key: "method", header: "পদ্ধতি" },
          { key: "amount", header: "পরিমাণ" },
          { key: "paid", header: "গৃহীত" },
          { key: "status", header: "অবস্থা" },
          { key: "trx", header: "গেটওয়ে TrxID" },
          { key: "time", header: "সময় (Asia/Dhaka)" },
        ]}
        rows={transactionRows}
      />

      <section className="space-y-3">
        <h2 className="text-h3">ম্যানুয়াল TrxID যাচাই কিউ</h2>
        <ManualTrxReviewQueue submissions={demoManualSubmissions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">COD সেটেলমেন্ট — কুরিয়ার অনুযায়ী</h2>
        <DataTable
          caption="নমুনা (TEMPORARY DEMO) — বিতর্কিত পরিমাণ আলাদা দেখানো হয়, বকেয়া/পরিশোধিত মোটে কখনো মেশানো হয় না"
          columns={[
            { key: "courier", header: "কুরিয়ার" },
            { key: "shipments", header: "শিপমেন্ট" },
            { key: "collected", header: "সংগৃহীত" },
            { key: "charge", header: "কুরিয়ার চার্জ" },
            { key: "outstanding", header: "বকেয়া পাওনা" },
            { key: "settled", header: "পরিশোধিত" },
            { key: "disputed", header: "বিতর্কিত" },
          ]}
          rows={codRows}
        />
        {disputedRows.map((r) => (
          <p key={r.shipmentId} className="flex items-start gap-1.5 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <span aria-hidden="true" className="mt-px shrink-0"><Icon name="alert" size={13} /></span>
            <span>বিতর্কিত: শিপমেন্ট <span className="font-mono">{r.shipmentId}</span> (অর্ডার #{r.orderId},{" "}
            {COURIER_LABELS_BN[r.provider]}) — কুরিয়ারের দাবি <Money poisha={r.collectedPoisha} />, পাওনা{" "}
            <Money poisha={r.payablePoisha} />। এই পরিমাণ নিজে থেকে সমন্বয় করা হয়নি — কুরিয়ার ইনভয়েসের সঙ্গে
            মিলিয়ে নিষ্পত্তি করুন।</span>
          </p>
        ))}
      </section>

      <Card className="shadow-card">
        <h2 className="text-h3">পেমেন্ট লিংক ও দৈনিক ক্যাশ ক্লোজিং</h2>
        <p className="mt-1 text-sm text-text-muted">
          পেমেন্ট লিংক তৈরি/তালিকা, bKash/Nagad SMS যাচাই এবং দৈনিক ক্যাশ ক্লোজিং BD Tools-এ আছে — এখানে আবার
          বানানো হয়নি।
        </p>
        <Link
          href="/admin/bd-tools"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700"
        >
          BD Tools খুলুন →
        </Link>
      </Card>
    </div>
  );
}
