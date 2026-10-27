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
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import {
  COURIER_LABELS,
  dhakaTime,
  dhakaYmd,
  paymentMethodLabel,
  summarizeCodByProvider,
  summarizeTransactions,
  totalCodOutstandingPoisha,
} from "./lib";
import { PAYMENTS_STRINGS } from "./strings";
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

const PAYMENT_STATUS_TONE: Record<PaymentStatus, "warning" | "info" | "success" | "danger" | "brand"> = {
  UNPAID: "warning",
  PARTIAL: "info",
  PAID: "success",
  FAILED: "danger",
  REFUNDED: "info",
  PARTIALLY_REFUNDED: "brand",
};

const PAYMENT_STATUS_KEY: Record<PaymentStatus, keyof typeof PAYMENTS_STRINGS.bn> = {
  UNPAID: "statusUnpaid",
  PARTIAL: "statusPartial",
  PAID: "statusPaid",
  FAILED: "statusFailed",
  REFUNDED: "statusRefunded",
  PARTIALLY_REFUNDED: "statusPartiallyRefunded",
};

export default async function PaymentsPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, PAYMENTS_STRINGS);
  const PaymentStatusBadge = ({ status }: { status: PaymentStatus }) => (
    <Badge tone={PAYMENT_STATUS_TONE[status]}>{t[PAYMENT_STATUS_KEY[status]]}</Badge>
  );
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
    method: paymentMethodLabel(locale, t.method),
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
    courier: COURIER_LABELS[locale][s.provider],
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
        title={t.title}
        description={t.description}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={t.collectedToday}
          value={formatPoisha(txSummary.collectedTodayPoisha)}
          delta={t.todayDhaka}
          icon={<Icon name="banknote" size={22} />}
        />
        <StatCard
          label={t.manualPending}
          value={String(pendingManualCount)}
          delta={t.trxQueue}
          deltaTone={pendingManualCount > 0 ? "down" : "up"}
          icon={<Icon name="clock" size={22} />}
        />
        <StatCard
          label={t.codOutstanding}
          value={formatPoisha(codOutstanding)}
          delta={t.pendingSettlement}
          icon={<Icon name="truck" size={22} />}
        />
        <StatCard
          label={t.refundedToday}
          value={formatPoisha(txSummary.refundedTodayPoisha)}
          delta={t.todayDhaka}
          deltaTone="down"
          icon={<Icon name="rotate-ccw" size={22} />}
        />
      </div>

      {attempts.length > 0 ? (
        <DataTable
          caption={t.txCaption}
          columns={[
            { key: "order", header: t.colOrder },
            { key: "method", header: t.colMethod },
            { key: "amount", header: t.colAmount },
            { key: "paid", header: t.colPaid },
            { key: "status", header: t.colStatus },
            { key: "trx", header: t.colGatewayTrx },
            { key: "time", header: t.colTime },
          ]}
          rows={transactionRows}
        />
      ) : (
        <Card className="shadow-card">
          <p className="text-sm text-text-muted">
            {t.noAttempts}
          </p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-h3">{t.manualQueueTitle}</h2>
        <ManualTrxReviewQueue submissions={manualSubmissions} />
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">{t.codTitle}</h2>
        <DataTable
          caption={t.codCaption}
          columns={[
            { key: "courier", header: t.colCourier },
            { key: "shipments", header: t.colShipments },
            { key: "collected", header: t.colCollected },
            { key: "charge", header: t.colCourierCharge },
            { key: "outstanding", header: t.colOutstanding },
            { key: "settled", header: t.colSettled },
            { key: "disputed", header: t.colDisputed },
          ]}
          rows={codTableRows}
        />
        {disputedRows.map((r) => (
          <p key={r.shipmentId} className="flex items-start gap-1.5 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <span aria-hidden="true" className="mt-px shrink-0"><Icon name="alert" size={13} /></span>
            <span>{t.disputedPrefix} <span className="font-mono">{r.shipmentId}</span> ({t.disputedOrder} #{r.orderId},{" "}
            {COURIER_LABELS[locale][r.provider]}) — {t.disputedClaim} <Money poisha={r.collectedPoisha} />, {t.disputedPayable}{" "}
            <Money poisha={r.payablePoisha} />{t.disputedSuffix}</span>
          </p>
        ))}
      </section>

      <Card className="shadow-card">
        <h2 className="text-h3">{t.linksTitle}</h2>
        <p className="mt-1 text-sm text-text-muted">
          {t.linksBody}
        </p>
        <Link
          href="/admin/bd-tools"
          className="mt-3 inline-flex min-h-[44px] items-center rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-md transition hover:opacity-90"
        >
          {t.openBdTools}
        </Link>
      </Card>
    </div>
  );
}
