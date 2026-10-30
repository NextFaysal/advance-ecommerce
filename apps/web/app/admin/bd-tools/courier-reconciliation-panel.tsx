"use client";

/**
 * BD Tools — কুরিয়ার রিকনসিলিয়েশন panel with CSV file upload.
 *
 * Connects to:
 * - POST /api/v1/admin/bd/courier-invoice/import
 *
 * Allows staff/accountants to:
 * 1. Select courier (Steadfast, Pathao, RedX, Paperfly, eCourier).
 * 2. Upload or drag-and-drop a courier invoice CSV file.
 * 3. Download a sample CSV format template.
 * 4. Instantly reconcile against shipments and view matched vs disputed rows.
 * 5. Download invalid rows error report CSV if any format errors occur.
 */
import { useState, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { StatCard } from "@/components/ui/stat-card";
import { Icon } from "@/components/ui/icon";
import { Money, formatPoisha } from "@/components/ui/money";
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";
import { reconciliationReason, reconciliationStatusLabels } from "./labels";
import type { CourierInvoiceRun } from "@/bd/courier-invoice";

const SAMPLE_CSV = `trackingId,orderId,codCollected,deliveryCharge,codFee,returnCharge,status
STD10023451,ord_sample_01,1500.00,60.00,15.00,0,delivered
STD10023452,ord_sample_02,2200.00,100.00,22.00,0,delivered
STD10023453,ord_sample_03,0,60.00,0,60.00,returned`;

const COURIER_OPTIONS = [
  { key: "steadfast", label: "Steadfast Courier" },
  { key: "pathao", label: "Pathao Courier" },
  { key: "redx", label: "RedX Logistics" },
  { key: "paperfly", label: "Paperfly" },
  { key: "ecourier", label: "eCourier" },
];

export function CourierReconciliationPanel({
  initialRun,
  initialOpenDisputes,
}: {
  initialRun: CourierInvoiceRun | null;
  initialOpenDisputes: number;
}) {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);

  const [run, setRun] = useState<CourierInvoiceRun | null>(initialRun);
  const [openDisputes, setOpenDisputes] = useState<number>(initialOpenDisputes);

  const [courierKey, setCourierKey] = useState("steadfast");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [showUploadForm, setShowUploadForm] = useState(!initialRun);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (!selected.name.toLowerCase().endsWith(".csv")) {
        setUploadError(locale === "bn" ? "দয়া করে শুধুমাত্র .csv ফাইল নির্বাচন করুন।" : "Please select a .csv file only.");
        setFile(null);
        return;
      }
      setFile(selected);
      setUploadError(null);
    }
  };

  const handleDownloadSample = () => {
    const blob = new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `courier_invoice_sample.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadErrorReport = () => {
    if (!run?.errorReportCsv) return;
    const blob = new Blob([run.errorReportCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `invoice_errors_${run.runId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setUploadError(locale === "bn" ? "প্রথমে একটি CSV ফাইল সিলেক্ট করুন।" : "Please select a CSV file first.");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setUploadSuccess(null);

    try {
      const csvText = await file.text();

      const res = await fetch("/api/v1/admin/bd/courier-invoice/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courierKey, csvText }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setUploadError(json?.error?.message ?? (locale === "bn" ? "ফাইল আপলোডে সমস্যা হয়েছে।" : "Failed to import CSV."));
        return;
      }

      if (json?.data) {
        setRun(json.data as CourierInvoiceRun);
        setOpenDisputes((prev) => prev + (json.data.summary?.disputedCount ?? 0));
        setUploadSuccess(
          locale === "bn"
            ? `ইনভয়েস সফলভাবে রিকনসিল করা হয়েছে! মোট ${json.data.totalRows}টি সারি প্রসেস হয়েছে।`
            : `Invoice reconciled successfully! Processed ${json.data.totalRows} rows.`
        );
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch {
      setUploadError(locale === "bn" ? "নেটওয়ার্ক ত্রুটি — ফাইল আপলোড করা যায়নি।" : "Network error — failed to upload file.");
    } finally {
      setUploading(false);
    }
  };

  const disputed = run?.rows?.filter((r) => r.disputed) ?? [];
  const matched = run?.rows?.filter((r) => !r.disputed) ?? [];
  const summary = run?.summary;

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
    <div className="space-y-6">
      {/* Upload Toggle & Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="text-base font-semibold text-text-main">
            {locale === "bn" ? "কুরিয়ার ইনভয়েস রিকনসিলিয়েশন (CSV আপলোড)" : "Courier Invoice Reconciliation (CSV Upload)"}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {locale === "bn"
              ? "কুরিয়ারের পেমেন্ট শিট আপলোড করে টাকা ও ডেলিভারি চার্জের গরমিল পরীক্ষা করুন"
              : "Upload courier payout CSV to detect charge/COD mismatches and dispute invalid fees"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleDownloadSample}
            className="text-xs"
          >
            <Icon name="package" size={14} className="mr-1 inline" />
            {locale === "bn" ? "নমুনা CSV ডাউনলোড" : "Sample CSV"}
          </Button>
          {run && (
            <Button
              type="button"
              variant={showUploadForm ? "ghost" : "primary"}
              size="sm"
              onClick={() => setShowUploadForm(!showUploadForm)}
              className="text-xs"
            >
              <Icon name={showUploadForm ? "x" : "plus"} size={14} className="mr-1 inline" />
              {showUploadForm
                ? (locale === "bn" ? "আপলোড লুকান" : "Hide Upload")
                : (locale === "bn" ? "নতুন CSV আপলোড করুন" : "Upload New CSV")}
            </Button>
          )}
        </div>
      </div>

      {/* CSV Upload Form Box */}
      {showUploadForm && (
        <Card className="border border-brand-200 bg-brand-50/20 p-4 sm:p-5">
          <form onSubmit={handleUpload} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  {locale === "bn" ? "কুরিয়ার কোম্পানি *" : "Courier Provider *"}
                </label>
                <select
                  value={courierKey}
                  onChange={(e) => setCourierKey(e.target.value)}
                  className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
                >
                  {COURIER_OPTIONS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text-muted">
                  {locale === "bn" ? "ইনভয়েস CSV ফাইল নির্বাচন করুন *" : "Select Invoice CSV File *"}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="block w-full text-xs text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-brand-600"
                  />
                  <Button
                    type="submit"
                    disabled={uploading || !file}
                    size="sm"
                    className="whitespace-nowrap"
                  >
                    {uploading ? (
                      locale === "bn" ? "যাচাই হচ্ছে..." : "Reconciling..."
                    ) : (
                      <>
                        <Icon name="check" size={14} className="mr-1 inline" />
                        {locale === "bn" ? "রিকনসিল করুন" : "Reconcile"}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg bg-surface-2 p-2.5 text-xs text-text-subtle">
              <span className="font-semibold">{locale === "bn" ? "প্রয়োজনীয় কলাম হেডার:" : "Required CSV Columns:"} </span>
              <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px]">
                trackingId, orderId, codCollected, deliveryCharge, codFee, returnCharge, status
              </code>
            </div>

            {uploadError && (
              <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                ⚠ {uploadError}
              </div>
            )}

            {uploadSuccess && (
              <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                ✓ {uploadSuccess}
              </div>
            )}
          </form>
        </Card>
      )}

      {/* When no run has been imported and upload form is idle */}
      {!run ? (
        <EmptyState
          title={s.reconEmptyTitle}
          description={
            locale === "bn"
              ? "উপরে কুরিয়ার নির্বাচন করে তাদের দেওয়া ইনভয়েস CSV আপলোড করুন। সিস্টেম স্বয়ংক্রিয়ভাবে গরমিল বের করবে।"
              : "Select a courier above and upload their payout invoice CSV. The system will automatically detect discrepancies."
          }
        />
      ) : (
        <div className="space-y-5">
          {/* Active Run Header */}
          <div className="flex flex-wrap items-center justify-between gap-2">
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

            {run.errorReportCsv && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadErrorReport}
                className="text-xs text-danger hover:bg-danger-soft"
              >
                <Icon name="alert" size={14} className="mr-1 inline" />
                {locale === "bn" ? "ভুল সারির রিপোর্ট (CSV)" : "Error Rows CSV"}
              </Button>
            )}
          </div>

          {/* Stat Cards */}
          {summary && (
            <>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label={s.statMatched}
                  value={String(summary.matchedCount)}
                  delta={s.statDeltaThisRun}
                  icon={<Icon name="check" size={22} />}
                />
                <StatCard
                  label={s.statDisputed}
                  value={String(summary.disputedCount)}
                  delta={s.statDeltaThisRun}
                  deltaTone="down"
                  icon={<Icon name="alert" size={22} />}
                  accent="bg-danger-soft text-danger"
                />
                <StatCard
                  label={s.statMissingExtra}
                  value={`${summary.missingCount} / ${summary.extraCount}`}
                  delta={s.statDeltaThisRun}
                  icon={<Icon name="package" size={22} />}
                />
                <StatCard
                  label={s.statExpectedTotal}
                  value={formatPoisha(summary.expectedTotalPoisha)}
                  delta={s.statDeltaThisRun}
                  icon={<Icon name="banknote" size={22} />}
                />
              </div>

              {/* Matched vs Disputed Total Cards */}
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-border bg-success-soft p-3">
                  <p className="text-xs text-success-solid">{s.matchedTotalLabel}</p>
                  <p className="mt-1 text-base font-semibold text-text-main">
                    <Money poisha={summary.matchedTotalPoisha} />
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-danger-soft p-3">
                  <p className="text-xs text-danger">{s.disputedTotalLabel}</p>
                  <p className="mt-1 text-base font-semibold text-text-main">
                    <Money poisha={summary.disputedTotalPoisha} />
                  </p>
                </div>
              </div>
            </>
          )}

          {/* Disputed Rows Table */}
          <div>
            <h3 className="mb-2 font-display text-sm font-semibold text-text-main">
              {s.disputedHeading}
            </h3>
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

          {/* Matched Rows Table */}
          {matchedRows.length > 0 && (
            <div>
              <h3 className="mb-2 font-display text-sm font-semibold text-text-main">
                {s.matchedHeading}
              </h3>
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
          )}
        </div>
      )}
    </div>
  );
}
