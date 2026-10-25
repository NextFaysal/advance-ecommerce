import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Money, formatPoisha } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Icon } from "@/components/ui/icon";
import type { PaymentStatus } from "@/integrations/payment";
import { listAttempts } from "@/integrations/sandbox/db-store";
import { listManualTrx } from "@/integrations/sandbox/manual-trx";
import { buildCodSettlementReport } from "@/integrations/sandbox/cod-settlement";
import {
  COURIER_LABELS_BN,
  dhakaTime,
  dhakaYmd,
  paymentMethodLabelBn,
  summarizeCodByProvider,
  summarizeTransactions,
  totalCodOutstandingPoisha,
} from "./lib";
import { ManualTrxReviewQueue } from "./review-queue";

// Admin > Payments — real data (wired 2026-10-25).
// Every figure below is computed from persisted DB records via the same
// service functions the admin APIs serve:
//   transactions  <- listAttempts()            (payment_attempts + payments + refunds)
//   manual queue  <- listManualTrx()           (manual_trx_submissions)
//   COD panel     <- buildCodSettlementReport  (persisted Shipment rows, DELIVERED)
// The gateways behind these records run in sandbox mode (that is the
// integrations layer's mode until live provider accounts are connected),
// but the records themselves are real rows — nothing here is sample data.
// Review decisions go through POST /api/v1/admin/payments/manual-trx.
// Payment links + daily cash closing live in BD Tools — linked, not rebuilt.

export const dynamic = "force-dynamic";

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

export default async function PaymentsPage() {
  const [attempts, manualSubmissions, codReport] = await Promise.all([
    listAttempts(),
    listManualTrx(),
    buildCodSettlementReport("all"),
  ]);
  const todayYmd = dhakaYmd(new Date().toISOString());
  const txSummary = summarizeTransactions(attempts, todayYmd);
  const pendingManualCount = manualSubmissions.filter((s) => s.status === "pending").length;
  const codRows = codReport.rows;
  const codOutstanding = totalCodOutstandingPoisha(codRows);
  const codSummaries = summarizeCodByProvider(codRows);
  const disputedRows = codRows.filter((r) => r.status === "disputed");

  const transactionRows = attempts.map((t) => ({
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

  const codTableRows = codSummaries.map((s) => ({
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
        description="আসল ডেটা — পেমেন্ট প্রচেষ্টা, ম্যানুয়াল TrxID জমা ও ডেলিভারি হওয়া শিপমেন্টের COD হিসাব ডাটাবেস থেকে। গেটওয়ে বর্তমানে স্যান্ডবক্স মোডে চলে (লাইভ প্রোভাইডার অ্যাকাউন্ট যুক্ত হলে একই রেকর্ডে লাইভ লেনদেন আসবে)।"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="আজ সংগৃহীত"
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
          label="আজ ফেরত"
          value={formatPoisha(txSummary.refundedTodayPoisha)}
          delta="আজ, Asia/Dhaka"
          deltaTone="down"
          icon={<Icon name="rotate-ccw" size={22} />}
        />
      </div>

      {attempts.length > 0 ? (
        <DataTable
          caption="লেনদেন — payment_attempts টেবিল থেকে (নতুন থেকে পুরনো নয়, রেকর্ডের ক্রমে)"
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
      ) : (
        <Card className="shadow-card">
          <p className="text-sm text-text-muted">
            এখনো কোনো পেমেন্ট প্রচেষ্টা রেকর্ড হয়নি — প্রথম অর্ডারের পেমেন্ট এলেই এখানে দেখা যাবে।
          </p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-h3">ম্যানুয়াল TrxID যাচাই কিউ</h2>
        <ManualTrxReviewQueue submissions={manualSubmissions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">COD সেটেলমেন্ট — কুরিয়ার অনুযায়ী</h2>
        <DataTable
          caption="ডেলিভারি হওয়া শিপমেন্ট থেকে হিসাব করা — বিতর্কিত পরিমাণ আলাদা দেখানো হয়, বকেয়া/পরিশোধিত মোটে কখনো মেশানো হয় না। সেটেলমেন্ট অবস্থা শিপমেন্ট রেকর্ডে সংরক্ষিত হয়; ইনভয়েস অমিলের সারি BD Tools-এর রিকনসিলিয়েশনে বিবাদযুক্ত হয়।"
          columns={[
            { key: "courier", header: "কুরিয়ার" },
            { key: "shipments", header: "শিপমেন্ট" },
            { key: "collected", header: "সংগৃহীত" },
            { key: "charge", header: "কুরিয়ার চার্জ" },
            { key: "outstanding", header: "বকেয়া পাওনা" },
            { key: "settled", header: "পরিশোধিত" },
            { key: "disputed", header: "বিতর্কিত" },
          ]}
          rows={codTableRows}
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
          className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-md transition hover:opacity-90"
        >
          BD Tools খুলুন →
        </Link>
      </Card>
    </div>
  );
}
