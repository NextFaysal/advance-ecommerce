"use client";

// Admin product IMPORT page — P4 completion of the Step-10 import;
// .xlsx support added in wave 16.
// Flow: pick a .csv or .xlsx file -> POST /api/v1/admin/products/import
// (preview: per-row validation, NOTHING is saved) -> review counts,
// detected format + money units and the per-row error table ->
// "Confirm" POSTs the same file payload to /import/confirm, which
// re-parses it server-side and creates every valid row's product as
// DRAFT. An .xlsx workbook is read server-side from its FIRST sheet
// only, into the same row table as CSV — validation is identical.
// Error rows are never silently dropped: they are listed here and
// downloadable as an error-report CSV.
import { useRef, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/admin-shell/PageHeader";
import { ADMIN_STRINGS } from "@/admin/strings";
import type { ImportMoneyUnits, ImportRow } from "@/catalog/import";
import ExternalImports from "./external-imports";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS, type ProductsStrings } from "../strings";

interface InvalidRow {
  row: number;
  raw: Record<string, string>;
  errors: { row: number; field: string; message: string }[];
}

type ImportFormat = "csv" | "xlsx";

/** The file payload kept between preview and confirm — the confirm
 *  endpoint re-parses the same bytes server-side. */
type FilePayload = { kind: "csv"; text: string } | { kind: "xlsx"; base64: string };

interface PreviewData {
  format: ImportFormat;
  totalRows: number;
  validCount: number;
  invalidCount: number;
  validRows: ImportRow[];
  invalidRows: InvalidRow[];
  errorReportCsv: string;
  moneyUnits: ImportMoneyUnits;
}

interface RowOutcome {
  row: number;
  slug: string;
  sku: string;
  status: "created" | "skipped" | "failed";
  productId?: string;
  message?: string;
}

interface ConfirmData {
  fileName: string | null;
  format: ImportFormat;
  totalRows: number;
  createdProductCount: number;
  createdRowCount: number;
  skippedRowCount: number;
  failedRowCount: number;
  createdProducts: { id: string; slug: string }[];
  outcomes: RowOutcome[];
  errorReportCsv: string;
  moneyUnits: ImportMoneyUnits;
}

function unitLabels(s: ProductsStrings): Record<string, string> {
  return { poisha: s.unitPoisha, taka: s.unitTaka, mixed: s.unitMixed, none: s.unitNone };
}

const TEMPLATE_HEADERS = [
  "slug",
  "title_bn",
  "title_en",
  "description_bn",
  "description_en",
  "category_slug",
  "brand_name",
  "status",
  "tags",
  "sku",
  "price_taka",
  "compare_at_taka",
  "cost_taka",
  "stock",
  "image_url",
];

const TEMPLATE_ROWS: string[][] = [
  [
    "cotton-panjabi",
    "সুতি পাঞ্জাবি",
    "Cotton Panjabi",
    "নরম সুতি কাপড়ের আরামদায়ক পাঞ্জাবি",
    "Comfortable panjabi in soft cotton fabric",
    "fashion",
    "Example Brand",
    "DRAFT",
    "ঈদ|পাঞ্জাবি",
    "PANJABI-M",
    "1250",
    "1600",
    "800",
    "25",
    "",
  ],
  [
    "cotton-panjabi",
    "সুতি পাঞ্জাবি",
    "Cotton Panjabi",
    "নরম সুতি কাপড়ের আরামদায়ক পাঞ্জাবি",
    "Comfortable panjabi in soft cotton fabric",
    "fashion",
    "Example Brand",
    "DRAFT",
    "ঈদ|পাঞ্জাবি",
    "PANJABI-L",
    "1350",
    "1700",
    "850",
    "18",
    "",
  ],
];

function csvEscape(value: string): string {
  return value.includes(",") || value.includes('"') || value.includes("\n")
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

function buildTemplateCsv(): string {
  const lines = [TEMPLATE_HEADERS.join(",")];
  for (const row of TEMPLATE_ROWS) lines.push(row.map(csvEscape).join(","));
  return lines.join("\n");
}

function downloadTextFile(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function formatPoisha(poisha: number): string {
  // Locale-neutral on purpose: digit script is the separate numerals
  // preference (doc 30), not coupled to the UI language in this wave.
  return `৳${(poisha / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ArrayBuffer -> base64 without blowing the call stack on big files. */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function formatLabels(s: ProductsStrings): Record<ImportFormat, string> {
  return { csv: s.formatCsv, xlsx: s.formatXlsx };
}

type Phase = "pick" | "previewing" | "preview" | "confirming" | "done";

export default function ProductImportPage() {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const UNIT_LABELS = unitLabels(s);
  const FORMAT_LABELS = formatLabels(s);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("pick");
  const [fileName, setFileName] = useState<string>("");
  const [payload, setPayload] = useState<FilePayload | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ConfirmData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  async function handleFile(file: File) {
    setErrorMessage("");
    setPreview(null);
    setResult(null);
    setFileName(file.name);
    const lowerName = file.name.toLowerCase();
    let filePayload: FilePayload;
    if (lowerName.endsWith(".csv")) {
      filePayload = { kind: "csv", text: await file.text() };
    } else if (lowerName.endsWith(".xlsx")) {
      filePayload = { kind: "xlsx", base64: arrayBufferToBase64(await file.arrayBuffer()) };
    } else {
      setPhase("pick");
      setErrorMessage(s.impFileOnlyError);
      return;
    }
    setPayload(filePayload);
    setPhase("previewing");
    try {
      const res = await fetch("/api/v1/admin/products/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          filePayload.kind === "csv" ? { csv: filePayload.text } : { xlsxBase64: filePayload.base64 },
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: PreviewData;
        error?: { message?: string };
      };
      if (!res.ok || !data.data) {
        setPhase("pick");
        setErrorMessage(data.error?.message ?? s.impPreviewFail);
        return;
      }
      setPreview(data.data);
      setPhase("preview");
    } catch {
      setPhase("pick");
      setErrorMessage(s.impServerFail);
    }
  }

  async function handleConfirm() {
    if (!preview || preview.validCount === 0 || !payload) return;
    setPhase("confirming");
    setErrorMessage("");
    try {
      const res = await fetch("/api/v1/admin/products/import/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(payload.kind === "csv" ? { csv: payload.text } : { xlsxBase64: payload.base64 }),
          fileName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: ConfirmData;
        error?: { message?: string };
      };
      if (!res.ok || !data.data) {
        setPhase("preview");
        setErrorMessage(data.error?.message ?? s.impConfirmFail);
        return;
      }
      setResult(data.data);
      setPhase("done");
    } catch {
      setPhase("preview");
      setErrorMessage(s.impServerFail);
    }
  }

  function reset() {
    setPhase("pick");
    setFileName("");
    setPayload(null);
    setPreview(null);
    setResult(null);
    setErrorMessage("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const busy = phase === "previewing" || phase === "confirming";

  return (
    <main className="min-w-0">
      <PageHeader
        title={s.impTitle}
        subtitle={s.impDesc}
        breadcrumbs={s.impBreadcrumb.split(" / ").map((label) => ({ label }))}
        breadcrumbLabel={pick(locale, ADMIN_STRINGS).breadcrumb}
        actions={
          <Link
            href="/admin/products"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-medium shadow-xs transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft"
          >
            {s.impBackLink}
          </Link>
        }
      />

      {/* Stepper — presentational only, follows the existing phase. */}
      <ol className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={s.impStepperAria}>
        {[s.impStep1, s.impStep2, s.impStep3].map((label, i) => {
          const activeIdx = phase === "done" ? 2 : phase === "preview" || phase === "confirming" ? 1 : 0;
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm ${
                  state === "done"
                    ? "bg-success-solid text-white"
                    : state === "active"
                      ? "brand-gradient text-white shadow-md"
                      : "border border-border bg-card text-text-subtle"
                }`}
              >
                {state === "done" ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span className={`text-sm ${state === "todo" ? "text-text-subtle" : "font-semibold text-text-main"}`}>{label}</span>
              {i < 2 && <span aria-hidden="true" className="mx-1 hidden h-px w-8 bg-border sm:block" />}
            </li>
          );
        })}
      </ol>

      <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-base font-semibold">{s.impFormatTitle}</h2>
          <span className="rounded-full bg-brand-soft px-2.5 py-1 font-mono text-[11px] font-bold text-brand-ink ring-1 ring-inset ring-brand-ink/15">CSV</span>
          <span className="rounded-full bg-success-soft px-2.5 py-1 font-mono text-[11px] font-bold text-success-solid ring-1 ring-inset ring-success-solid/20">Excel (.xlsx)</span>
        </div>
        <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-text-muted">
          <li>{s.impB1Pre} <span className="font-mono">slug</span>{s.impB1Post}</li>
          <li>{s.impB2Pre} <span className="font-mono">slug, title_bn, title_en, sku, stock</span> {s.impB2Mid} <span className="font-mono">category_slug</span> {s.impB2Post}</li>
          <li>
            {s.impB3Pre} <span className="font-mono">price_poisha</span> {s.impB3Mid1}{" "}
            <span className="font-mono">price_taka</span> {s.impB3Mid2}{" "}
            <span className="font-mono">compare_at</span> {s.impB3Mid3} <span className="font-mono">cost</span>{s.impB3Post} (<span className="font-mono">*_poisha</span> / <span className="font-mono">*_taka</span>)।
          </li>
          <li><span className="font-mono">tags</span> {s.impB4Pre} <span className="font-mono">|</span>{s.impB4Mid} <span className="font-mono">status</span>{s.impB4Post}</li>
          <li>{s.impB5Pre} <strong>{s.impB5Strong}</strong> {s.impB5Post}</li>
        </ul>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadTextFile("product-import-template.csv", buildTemplateCsv())}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-border bg-card px-4 text-sm font-medium shadow-xs transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 3v11" />
              <path d="m8 10 4 4 4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            {s.impTemplateBtn}
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
        <h2 className="font-display text-base font-semibold">{s.impChooseTitle}</h2>
        <div className="mt-3 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 px-4 py-6 text-center">
          <span aria-hidden="true" className="brand-soft-gradient mx-auto flex h-14 w-14 items-center justify-center rounded-full text-brand-600 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M12 16V4" />
              <path d="m6 10 6-6 6 6" />
              <path d="M4 20h16" />
            </svg>
          </span>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
              className="max-w-full text-sm text-transparent file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-xl file:border-0 file:bg-brand-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white file:shadow-md file:transition hover:file:brightness-105 disabled:opacity-50"
            />
            {phase === "previewing" && <span className="text-sm font-medium text-text-muted">{s.impPreviewing}</span>}
          </div>
          {fileName && (
            <p className="mt-3.5">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-card px-3 py-1.5 font-mono text-xs font-medium text-text-main shadow-sm ring-1 ring-inset ring-brand-100">
                <span className="truncate">{fileName}</span>
              </span>
            </p>
          )}
        </div>
        {errorMessage && (
          <p className="anim-fade-in mt-3 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">{errorMessage}</p>
        )}
      </section>

      {preview && phase !== "done" && (
        <section className="anim-rise mt-4 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
          <h2 className="font-display text-base font-semibold">{s.impPreviewTitle}</h2>
          <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
              <div className="text-caption font-semibold text-brand-700">{s.impTotalRows}</div>
              <div className="mt-1 font-display text-h2 font-bold tabular-nums text-text-main">{preview.totalRows}</div>
            </div>
            <div className="rounded-2xl border border-success-solid/20 bg-success-soft/70 p-4">
              <div className="text-caption font-semibold text-success-solid">{s.impValidRows}</div>
              <div className="tnum mt-1 font-display text-h2 font-bold text-success-solid">{preview.validCount}</div>
            </div>
            <div className="rounded-2xl border border-danger/20 bg-danger-soft/70 p-4">
              <div className="text-caption font-semibold text-danger">{s.impInvalidRows}</div>
              <div className="tnum mt-1 font-display text-h2 font-bold text-danger">{preview.invalidCount}</div>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted ring-1 ring-inset ring-black/5">
              {s.impDetectedFormat} <strong className="text-text-main">{FORMAT_LABELS[preview.format]}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted ring-1 ring-inset ring-black/5">
              {s.impUnitsLine} <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.price]}</strong> {s.impUnitCompare}{" "}
              <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.compareAt]}</strong> {s.impUnitCost} <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.cost]}</strong>
            </span>
          </div>

          {preview.validRows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60 shadow-xs">
              <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-brand-50/40">
                <thead>
                  <tr className="bg-brand-50/70 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                    <th>Slug</th>
                    <th>SKU</th>
                    <th>{s.impColPrice}</th>
                    <th>{s.impColStock}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.validRows.slice(0, 100).map((row) => (
                    <tr key={row.sku} className="border-t border-border [&>td]:px-3 [&>td]:py-2">
                      <td className="font-mono text-xs">{row.slug}</td>
                      <td className="font-mono text-xs">{row.sku}</td>
                      <td className="font-mono tabular-nums">{formatPoisha(row.price_poisha)}</td>
                      <td className="tabular-nums">{row.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.validRows.length > 100 && (
                <p className="bg-surface-2/60 px-3 py-2 text-xs text-text-subtle">{s.impFirst100}</p>
              )}
            </div>
          )}

          {preview.invalidRows.length > 0 && (
            <div className="mt-5 rounded-2xl border border-danger/25 bg-danger-soft/50 p-3.5 sm:p-4">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-danger">
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-danger-soft text-danger">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                    <path d="M12 8v5" />
                    <path d="M12 16.5h.01" />
                  </svg>
                </span>
                {s.impInvalidTitle}
              </h3>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-danger/20 bg-card shadow-xs">
                <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-danger-soft/50">
                  <thead>
                    <tr className="bg-danger-soft/80 [&>th]:border-b [&>th]:border-danger/15 [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-danger">
                      <th>{s.impColRow}</th>
                      <th>SKU</th>
                      <th>{s.impColField}</th>
                      <th>{s.impColProblem}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.invalidRows.flatMap((invalid) =>
                      invalid.errors.map((err, i) => (
                        <tr key={`${invalid.row}-${i}`} className="border-t border-border/70 [&>td]:px-3 [&>td]:py-2">
                          <td className="tabular-nums">{invalid.row}</td>
                          <td className="font-mono text-xs">{invalid.raw.sku ?? ""}</td>
                          <td className="font-mono text-xs">{err.field}</td>
                          <td>{err.message}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                onClick={() => downloadTextFile("import-errors.csv", preview.errorReportCsv)}
                className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-danger/25 bg-card px-4 text-sm font-semibold text-danger shadow-xs transition duration-fast ease-smooth hover:bg-danger-soft"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 3v11" />
                  <path d="m8 10 4 4 4-4" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                {s.impErrorReportBtn}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={preview.validCount === 0 || phase === "confirming"}
              onClick={() => void handleConfirm()}
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "confirming" ? s.impConfirming : interpolate(s.impConfirmBtn, { count: preview.validCount })}
            </button>
            <button
              type="button"
              disabled={phase === "confirming"}
              onClick={reset}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition duration-fast ease-smooth hover:border-brand-300"
            >
              {s.cancelBtn}
            </button>
          </div>
          {preview.validCount === 0 && (
            <p className="mt-2 text-sm text-danger">{s.impNoValid}</p>
          )}
        </section>
      )}

      {phase === "done" && result && (
        <section className="anim-rise mt-4 rounded-2xl border border-success-solid/25 bg-card p-4 shadow-xs sm:p-5">
          <div className="flex items-start gap-3.5">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success-solid text-white shadow-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold">{s.impDoneTitle}</h2>
              <p className="mt-1 text-sm leading-relaxed text-text-muted">
                <strong className="text-success-solid">{interpolate(s.impDoneProducts, { count: result.createdProductCount })}</strong> {interpolate(s.impDoneCreatedSuffix, { count: result.createdRowCount })}{" "}
                <strong>{s.impDoneDraft}</strong> {interpolate(s.impDoneRest, { count: result.skippedRowCount })}
                {result.failedRowCount > 0 && <>{interpolate(s.impDoneFailedSuffix, { count: result.failedRowCount })}</>}।
              </p>
            </div>
          </div>
          {result.createdProducts.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {result.createdProducts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="inline-flex min-h-[36px] items-center rounded-full border border-brand-100 bg-brand-soft px-3.5 font-mono text-xs font-medium text-brand-ink transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-100"
                  >
                    {p.slug}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result.outcomes.some((o) => o.status !== "created") && (
            <div className="mt-4 overflow-x-auto rounded-2xl border border-border/60 shadow-xs">
              <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-brand-50/40">
                <thead>
                  <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                    <th>{s.impColRow}</th>
                    <th>SKU</th>
                    <th>{s.impColStatus}</th>
                    <th>{s.impColReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.outcomes
                    .filter((o) => o.status !== "created")
                    .map((o) => (
                      <tr key={o.row} className="border-t border-border [&>td]:px-3 [&>td]:py-2">
                        <td className="tabular-nums">{o.row}</td>
                        <td className="font-mono text-xs">{o.sku}</td>
                        <td>{o.status === "skipped" ? s.impSkippedStatus : s.impFailedStatus}</td>
                        <td>{o.message ?? ""}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/admin/products"
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:shadow-lift hover:brightness-105"
            >
              {s.impGoList}
            </Link>
            {result.errorReportCsv.trim() !== "row,field,message" && (
              <button
                type="button"
                onClick={() => downloadTextFile("import-errors.csv", result.errorReportCsv)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition duration-fast ease-smooth hover:border-brand-300"
              >
                {s.impErrorReportBtn}
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-4 text-sm font-medium transition duration-fast ease-smooth hover:border-brand-300"
            >
              {s.impAnotherFile}
            </button>
          </div>
        </section>
      )}

      {/* ADV-25: external-source importers (Woo/Shopify/Daraz) + feeds. */}
      <ExternalImports />
    </main>
  );
}
