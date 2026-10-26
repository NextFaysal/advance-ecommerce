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
import { PageHeader } from "@/components/ui/page-header";
import type { ImportMoneyUnits, ImportRow } from "@/catalog/import";
import ExternalImports from "./external-imports";

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

const UNIT_LABELS: Record<string, string> = {
  poisha: "পয়সা (poisha)",
  taka: "টাকা (taka)",
  mixed: "মিশ্র — কিছু সারিতে পয়সা, কিছুতে টাকা",
  none: "—",
};

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

const FORMAT_LABELS: Record<ImportFormat, string> = {
  csv: "CSV",
  xlsx: "Excel (.xlsx) — শুধু প্রথম শিট",
};

type Phase = "pick" | "previewing" | "preview" | "confirming" | "done";

export default function ProductImportPage() {
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
      setErrorMessage("শুধু .csv অথবা .xlsx (Excel) ফাইল চলবে।");
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
        setErrorMessage(data.error?.message ?? "প্রিভিউ তৈরি করা যায়নি।");
        return;
      }
      setPreview(data.data);
      setPhase("preview");
    } catch {
      setPhase("pick");
      setErrorMessage("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি। আবার চেষ্টা করুন।");
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
        setErrorMessage(data.error?.message ?? "ইমপোর্ট সম্পন্ন করা যায়নি।");
        return;
      }
      setResult(data.data);
      setPhase("done");
    } catch {
      setPhase("preview");
      setErrorMessage("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি। আবার চেষ্টা করুন।");
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
        title="পণ্য ইমপোর্ট (CSV / Excel)"
        description="CSV অথবা Excel (.xlsx) ফাইল থেকে একসঙ্গে অনেক পণ্য যোগ করুন। আগে প্রিভিউ দেখানো হয় — কনফার্ম না করা পর্যন্ত কিছুই সেভ হয় না। তৈরি হওয়া সব পণ্য খসড়া (DRAFT) থাকে; যাচাই করে নিজে প্রকাশ করুন।"
        breadcrumb="পণ্য / ইমপোর্ট"
        actions={
          <Link
            href="/admin/products"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition motion-fast hover:border-brand-300 hover:bg-brand-50"
          >
            ← পণ্যের তালিকা
          </Link>
        }
      />

      {/* Stepper — presentational only, follows the existing phase. */}
      <ol className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="ইমপোর্টের ধাপ">
        {["ফাইল বেছে নিন", "প্রিভিউ যাচাই করুন", "ইমপোর্ট সম্পন্ন"].map((label, i) => {
          const activeIdx = phase === "done" ? 2 : phase === "preview" || phase === "confirming" ? 1 : 0;
          const state = i < activeIdx ? "done" : i === activeIdx ? "active" : "todo";
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm ${
                  state === "done"
                    ? "bg-emerald-600 text-white"
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

      <section className="mt-4 rounded-lg border border-border/70 bg-card p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="font-display text-base font-semibold">ফাইল ফরম্যাট</h2>
          <span className="rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-100">CSV</span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-mono text-[11px] font-bold text-emerald-700 ring-1 ring-inset ring-emerald-100">Excel (.xlsx)</span>
        </div>
        <ul className="mt-3 list-inside list-disc space-y-1.5 text-sm leading-relaxed text-text-muted">
          <li>প্রতি সারি = একটি ভেরিয়েন্ট। একই <span className="font-mono">slug</span>-এর একাধিক সারি একই পণ্যের ভেরিয়েন্ট হিসেবে যুক্ত হয়।</li>
          <li>আবশ্যিক কলাম: <span className="font-mono">slug, title_bn, title_en, sku, stock</span> এবং দামের কলাম (নিচে দেখুন)। <span className="font-mono">category_slug</span> অবশ্যই আগে থেকে থাকা একটি ক্যাটাগরির slug হতে হবে।</li>
          <li>
            দাম দুই এককের যেকোনো একটিতে দেওয়া যায়: <span className="font-mono">price_poisha</span> (পূর্ণ সংখ্যা পয়সা) অথবা{" "}
            <span className="font-mono">price_taka</span> (দশমিক টাকা, যেমন 1250.50)। একই সারিতে একই দামের দুটি কলামই ভরলে সারিটি বাতিল হবে — কোন একক চলবে তা অনুমান করা হয় না।{" "}
            <span className="font-mono">compare_at</span> ও <span className="font-mono">cost</span>-এর ক্ষেত্রেও একই নিয়ম (<span className="font-mono">*_poisha</span> / <span className="font-mono">*_taka</span>)।
          </li>
          <li><span className="font-mono">tags</span> একাধিক হলে <span className="font-mono">|</span> দিয়ে আলাদা করুন। <span className="font-mono">status</span> যাই লিখুন, ইমপোর্টে সব পণ্য DRAFT হিসেবেই তৈরি হয়।</li>
          <li>CSV অথবা Excel (.xlsx) — দুই ফরম্যাটই চলে, নিয়ম একই। .xlsx ফাইলের ক্ষেত্রে শুধু <strong>প্রথম শিটটি</strong> পড়া হয়; দামের ঘরে সংখ্যা (number) হিসেবে মান রাখুন, টেক্সট হিসেবে &ldquo;৳&rdquo; চিহ্ন বা কমা দেবেন না।</li>
        </ul>
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadTextFile("product-import-template.csv", buildTemplateCsv())}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-border bg-card px-4 text-sm font-medium shadow-sm transition motion-fast hover:border-brand-300 hover:bg-brand-50"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 3v11" />
              <path d="m8 10 4 4 4-4" />
              <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
            টেমপ্লেট CSV ডাউনলোড
          </button>
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-border/70 bg-card p-4 shadow-card sm:p-5">
        <h2 className="font-display text-base font-semibold">১. ফাইল বেছে নিন</h2>
        <div className="mt-3 rounded-lg border-2 border-dashed border-brand-200 bg-brand-50/40 px-4 py-6 text-center">
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
              className="max-w-full text-sm text-transparent file:mr-3 file:min-h-[44px] file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-white file:shadow-md file:transition hover:file:brightness-105 disabled:opacity-50"
            />
            {phase === "previewing" && <span className="text-sm font-medium text-text-muted">প্রিভিউ তৈরি হচ্ছে…</span>}
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
          <p className="anim-fade-in mt-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">{errorMessage}</p>
        )}
      </section>

      {preview && phase !== "done" && (
        <section className="anim-rise mt-4 rounded-lg border border-border/70 bg-card p-4 shadow-card sm:p-5">
          <h2 className="font-display text-base font-semibold">২. প্রিভিউ যাচাই করুন</h2>
          <div className="mt-3.5 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-4">
              <div className="text-caption font-semibold text-brand-700">মোট সারি</div>
              <div className="mt-1 font-display text-h2 font-bold tabular-nums text-text-main">{preview.totalRows}</div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4">
              <div className="text-caption font-semibold text-emerald-700">বৈধ সারি</div>
              <div className="mt-1 font-display text-h2 font-bold tabular-nums text-emerald-700">{preview.validCount}</div>
            </div>
            <div className="rounded-lg border border-rose-100 bg-rose-50/70 p-4">
              <div className="text-caption font-semibold text-rose-700">ভুল সারি (বাদ যাবে)</div>
              <div className="mt-1 font-display text-h2 font-bold tabular-nums text-rose-600">{preview.invalidCount}</div>
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted ring-1 ring-inset ring-black/5">
              শনাক্ত ফরম্যাট: <strong className="text-text-main">{FORMAT_LABELS[preview.format]}</strong>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-text-muted ring-1 ring-inset ring-black/5">
              শনাক্ত হওয়া দামের একক — মূল্য: <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.price]}</strong> · তুলনামূলক মূল্য:{" "}
              <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.compareAt]}</strong> · ক্রয়মূল্য: <strong className="text-text-main">{UNIT_LABELS[preview.moneyUnits.cost]}</strong>
            </span>
          </div>

          {preview.validRows.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border/70 shadow-sm">
              <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-brand-50/40">
                <thead>
                  <tr className="bg-brand-50/70 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                    <th>Slug</th>
                    <th>SKU</th>
                    <th>দাম</th>
                    <th>স্টক</th>
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
                <p className="bg-surface-2/60 px-3 py-2 text-xs text-text-subtle">প্রথম ১০০টি বৈধ সারি দেখানো হচ্ছে; বাকিগুলোও ইমপোর্ট হবে।</p>
              )}
            </div>
          )}

          {preview.invalidRows.length > 0 && (
            <div className="mt-5 rounded-lg border border-rose-200 bg-rose-50/50 p-3.5 sm:p-4">
              <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-rose-700">
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="h-4 w-4">
                    <path d="M12 8v5" />
                    <path d="M12 16.5h.01" />
                  </svg>
                </span>
                ভুল সারি — এগুলো ইমপোর্ট হবে না
              </h3>
              <div className="mt-3 overflow-x-auto rounded-lg border border-rose-100 bg-card shadow-sm">
                <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-rose-50/50">
                  <thead>
                    <tr className="bg-rose-50/80 [&>th]:border-b [&>th]:border-rose-100 [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-rose-700">
                      <th>সারি</th>
                      <th>SKU</th>
                      <th>ফিল্ড</th>
                      <th>সমস্যা</th>
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
                className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-md border border-rose-200 bg-card px-4 text-sm font-semibold text-rose-700 shadow-sm transition motion-fast hover:bg-rose-50"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                  <path d="M12 3v11" />
                  <path d="m8 10 4 4 4-4" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                </svg>
                এরর রিপোর্ট CSV ডাউনলোড
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={preview.validCount === 0 || phase === "confirming"}
              onClick={() => void handleConfirm()}
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "confirming" ? "ইমপোর্ট হচ্ছে…" : `৩. কনফার্ম করুন — ${preview.validCount}টি বৈধ সারি ইমপোর্ট`}
            </button>
            <button
              type="button"
              disabled={phase === "confirming"}
              onClick={reset}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
            >
              বাতিল
            </button>
          </div>
          {preview.validCount === 0 && (
            <p className="mt-2 text-sm text-rose-600">কোনো বৈধ সারি নেই — ভুলগুলো ঠিক করে আবার ফাইল বেছে নিন।</p>
          )}
        </section>
      )}

      {phase === "done" && result && (
        <section className="anim-rise mt-4 rounded-lg border border-emerald-200 bg-card p-4 shadow-card sm:p-5">
          <div className="flex items-start gap-3.5">
            <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </span>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold">ইমপোর্ট সম্পন্ন</h2>
              <p className="mt-1 text-sm leading-relaxed text-text-muted">
                <strong className="text-emerald-600">{result.createdProductCount}টি পণ্য</strong> তৈরি হয়েছে ({result.createdRowCount}টি সারি) — সবগুলো{" "}
                <strong>খসড়া (DRAFT)</strong> অবস্থায়। পণ্যের তালিকা থেকে যাচাই করে প্রকাশ করুন। বাদ পড়েছে {result.skippedRowCount}টি ভুল সারি
                {result.failedRowCount > 0 && <>; তৈরি করতে ব্যর্থ হয়েছে {result.failedRowCount}টি সারি</>}।
              </p>
            </div>
          </div>
          {result.createdProducts.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {result.createdProducts.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="inline-flex min-h-[36px] items-center rounded-full border border-brand-100 bg-brand-50 px-3.5 font-mono text-xs font-medium text-brand-700 transition motion-fast hover:border-brand-300 hover:bg-brand-100"
                  >
                    {p.slug}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result.outcomes.some((o) => o.status !== "created") && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border/70 shadow-sm">
              <table className="w-full text-sm [&_tbody_tr]:transition [&_tbody_tr:hover]:bg-brand-50/40">
                <thead>
                  <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                    <th>সারি</th>
                    <th>SKU</th>
                    <th>অবস্থা</th>
                    <th>কারণ</th>
                  </tr>
                </thead>
                <tbody>
                  {result.outcomes
                    .filter((o) => o.status !== "created")
                    .map((o) => (
                      <tr key={o.row} className="border-t border-border [&>td]:px-3 [&>td]:py-2">
                        <td className="tabular-nums">{o.row}</td>
                        <td className="font-mono text-xs">{o.sku}</td>
                        <td>{o.status === "skipped" ? "বাদ (ভুল সারি)" : "ব্যর্থ"}</td>
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
              className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
            >
              পণ্যের তালিকায় যান
            </Link>
            {result.errorReportCsv.trim() !== "row,field,message" && (
              <button
                type="button"
                onClick={() => downloadTextFile("import-errors.csv", result.errorReportCsv)}
                className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
              >
                এরর রিপোর্ট CSV ডাউনলোড
              </button>
            )}
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
            >
              আরেকটি ফাইল ইমপোর্ট
            </button>
          </div>
        </section>
      )}

      {/* ADV-25: external-source importers (Woo/Shopify/Daraz) + feeds. */}
      <ExternalImports />
    </main>
  );
}
