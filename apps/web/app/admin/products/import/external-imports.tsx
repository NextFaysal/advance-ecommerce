"use client";

// External-source imports + outbound feeds (ADV-25) — a section on
// the catalog import page. Per-source cards (WooCommerce / Shopify /
// Daraz products, WooCommerce / Shopify orders) run the same
// discipline as the native import: upload -> DRY RUN (nothing saved)
// -> review the report -> confirm. Product confirms post the mapped
// platformCsv to the EXISTING /products/import/confirm endpoint, so
// create semantics are identical to a native import; order confirms
// post the original file to /imports/orders/confirm, which re-maps
// server-side. Every report is downloadable as JSON.
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS, type ProductsStrings } from "../strings";

interface MappingEntry {
  source: string;
  target: string;
  note?: string;
}

interface ProductReport {
  source: string;
  kind: "products";
  fileName: string | null;
  templateBased: boolean;
  currency: { source: string; exchangeRateToBdt: string | null; converted: boolean };
  totalSourceRows: number;
  mappedRowCount: number;
  productCount: number;
  validCount: number;
  invalidCount: number;
  invalidRows: { sourceRow: number; sourceRef: string; field: string; message: string }[];
  skippedSourceRows: { sourceRow: number; sourceRef: string; reason: string }[];
  unmappedColumns: string[];
  consumedColumns: string[];
  categoryWarnings: { slug: string; categorySlug: string; message: string }[];
  notes: string[];
  mapping: MappingEntry[];
  platformCsv: string;
  errorReportCsv: string;
}

interface ProductConfirmResult {
  createdProductCount: number;
  createdRowCount: number;
  skippedRowCount: number;
  failedRowCount: number;
  outcomes: { row: number; sku: string; status: string; message?: string }[];
}

interface OrderVerdict {
  sourceOrderId: string;
  sourceRows: number[];
  status: "ready" | "skipped";
  reasons: string[];
  warnings: string[];
  itemCount: number;
  currency: string;
}

interface OrderReport {
  source: string;
  kind: "orders";
  fileName: string | null;
  totalSourceRows: number;
  orderCount: number;
  readyCount: number;
  skippedCount: number;
  orders: OrderVerdict[];
  unmappedColumns: string[];
  notes: string[];
  mapping: MappingEntry[];
}

interface OrderConfirmResult {
  totalOrders: number;
  created: number;
  skipped: number;
  failed: number;
  outcomes: { sourceOrderId: string; status: string; orderNo?: string; message?: string }[];
}

interface FeedInfo {
  id: string;
  label: string;
  path: string;
  format: string;
  templateBased: boolean;
  productCount: number;
  itemCount: number;
}

type CardKind = "products" | "orders";
type Phase = "idle" | "dry-running" | "dry-run" | "confirming" | "done";

interface SourceDef {
  id: string;
  kind: CardKind;
  source: string;
  templateBased?: boolean;
  supportsOrders?: boolean;
}

function sourceTitle(s: ProductsStrings, id: string): string {
  switch (id) {
    case "woo-products": return s.extWooProductsTitle;
    case "shopify-products": return s.extShopifyProductsTitle;
    case "daraz-products": return s.extDarazProductsTitle;
    case "woo-orders": return s.extWooOrdersTitle;
    default: return s.extShopifyOrdersTitle;
  }
}
function sourceBlurb(s: ProductsStrings, id: string): string {
  switch (id) {
    case "woo-products": return s.extWooProductsBlurb;
    case "shopify-products": return s.extShopifyProductsBlurb;
    case "daraz-products": return s.extDarazProductsBlurb;
    case "woo-orders": return s.extWooOrdersBlurb;
    default: return s.extShopifyOrdersBlurb;
  }
}

const SOURCES: SourceDef[] = [
  { id: "woo-products", kind: "products", source: "woocommerce" },
  { id: "shopify-products", kind: "products", source: "shopify" },
  { id: "daraz-products", kind: "products", source: "daraz", templateBased: true },
  { id: "woo-orders", kind: "orders", source: "woocommerce" },
  { id: "shopify-orders", kind: "orders", source: "shopify" },
];

function downloadTextFile(name: string, text: string, type = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function MappingTable({ mapping }: { mapping: MappingEntry[] }) {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-semibold text-brand-700">
        {interpolate(s.extMappingTitle, { count: mapping.length })}
      </summary>
      <div className="mt-2 overflow-x-auto rounded-lg border border-border/70">
        <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-border/70">
          <thead>
            <tr className="bg-surface-2 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
              <th>{s.extColSource}</th>
              <th>{s.extColPlatform}</th>
              <th>{s.extColNote}</th>
            </tr>
          </thead>
          <tbody>
            {mapping.map((m) => (
              <tr key={m.source + m.target} className="[&>td]:px-3 [&>td]:py-2">
                <td className="font-mono text-xs">{m.source}</td>
                <td className="font-mono text-xs">{m.target}</td>
                <td className="text-xs text-text-muted">{m.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function NotesList({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="mt-3 list-inside list-disc space-y-1 text-sm leading-relaxed text-text-muted">
      {notes.map((note, i) => (
        <li key={i}>{note}</li>
      ))}
    </ul>
  );
}

function UnmappedColumns({ columns }: { columns: string[] }) {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  if (columns.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm font-semibold text-text-main">
        {interpolate(s.extUnmappedTitle, { count: columns.length })}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {columns.map((c) => (
          <span key={c} className="rounded-full bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-text-muted ring-1 ring-inset ring-black/5">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function SourceCard({ def }: { def: SourceDef }) {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [currency, setCurrency] = useState("BDT");
  const [rate, setRate] = useState("");
  const [productReport, setProductReport] = useState<ProductReport | null>(null);
  const [orderReport, setOrderReport] = useState<OrderReport | null>(null);
  const [productResult, setProductResult] = useState<ProductConfirmResult | null>(null);
  const [orderResult, setOrderResult] = useState<OrderConfirmResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const busy = phase === "dry-running" || phase === "confirming";

  function reset() {
    setPhase("idle");
    setCsvText("");
    setProductReport(null);
    setOrderReport(null);
    setProductResult(null);
    setOrderResult(null);
    setErrorMessage("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleFile(file: File) {
    reset();
    setFileName(file.name);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrorMessage(s.extCsvOnly);
      return;
    }
    setCsvText(await file.text());
  }

  async function handleDryRun() {
    if (csvText === "") return;
    setPhase("dry-running");
    setErrorMessage("");
    try {
      const url =
        def.kind === "products"
          ? "/api/v1/admin/imports/products/preview"
          : "/api/v1/admin/imports/orders/preview";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: def.source,
          csv: csvText,
          fileName,
          ...(def.kind === "products"
            ? { currency, exchangeRateToBdt: currency !== "BDT" ? rate : undefined }
            : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: ProductReport | OrderReport;
        error?: { message?: string };
      };
      if (!res.ok || !data.data) {
        setPhase("idle");
        setErrorMessage(data.error?.message ?? s.extDryRunFail);
        return;
      }
      if (def.kind === "products") setProductReport(data.data as ProductReport);
      else setOrderReport(data.data as OrderReport);
      setPhase("dry-run");
    } catch {
      setPhase("idle");
      setErrorMessage(s.impServerFail);
    }
  }

  async function handleConfirm() {
    setPhase("confirming");
    setErrorMessage("");
    try {
      if (def.kind === "products" && productReport) {
        // The existing native confirm endpoint re-parses the mapped
        // file server-side — identical semantics to a native import.
        const res = await fetch("/api/v1/admin/products/import/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: productReport.platformCsv, fileName }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          data?: ProductConfirmResult;
          error?: { message?: string };
        };
        if (!res.ok || !data.data) {
          setPhase("dry-run");
          setErrorMessage(data.error?.message ?? s.impConfirmFail);
          return;
        }
        setProductResult(data.data);
      } else if (def.kind === "orders") {
        const res = await fetch("/api/v1/admin/imports/orders/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: def.source, csv: csvText, fileName }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          data?: OrderConfirmResult;
          error?: { message?: string };
        };
        if (!res.ok || !data.data) {
          setPhase("dry-run");
          setErrorMessage(data.error?.message ?? s.impConfirmFail);
          return;
        }
        setOrderResult(data.data);
      }
      setPhase("done");
    } catch {
      setPhase("dry-run");
      setErrorMessage(s.impServerFail);
    }
  }

  function downloadReport() {
    const report = def.kind === "products" ? productReport : orderReport;
    if (!report) return;
    const result = def.kind === "products" ? productResult : orderResult;
    downloadTextFile(
      `import-report-${def.id}.json`,
      JSON.stringify({ report, result }, null, 2),
    );
  }

  const readyToConfirm =
    def.kind === "products"
      ? (productReport?.validCount ?? 0) > 0
      : (orderReport?.readyCount ?? 0) > 0;

  return (
    <section className="rounded-lg border border-border/70 bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-semibold">{sourceTitle(s, def.id)}</h3>
        {def.templateBased && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
            {s.extTemplateBadge}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">{sourceBlurb(s, def.id)}</p>
      {def.templateBased && (
        <p className="mt-1 text-sm leading-relaxed text-amber-700">
          {s.extDarazNote}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          className="max-w-full text-sm text-transparent file:mr-3 file:min-h-[40px] file:cursor-pointer file:rounded-md file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white file:shadow-md hover:file:brightness-105 disabled:opacity-50"
        />
        {def.kind === "products" && (
          <label className="flex items-center gap-2 text-sm text-text-muted">
            {s.extCurrencyLabel}
            <select
              value={currency}
              disabled={busy}
              onChange={(e) => setCurrency(e.target.value)}
              className="min-h-[40px] rounded-md border border-border bg-card px-2 text-sm text-text-main"
            >
              <option value="BDT">{s.extCurrencyBdt}</option>
              <option value="USD">USD</option>
              <option value="INR">INR</option>
              <option value="GBP">GBP</option>
              <option value="EUR">EUR</option>
              <option value="AED">AED</option>
            </select>
          </label>
        )}
        {def.kind === "products" && currency !== "BDT" && (
          <label className="flex items-center gap-2 text-sm text-text-muted">
            {interpolate(s.extRateLabel, { currency })}
            <input
              value={rate}
              disabled={busy}
              onChange={(e) => setRate(e.target.value)}
              placeholder={s.extRatePh}
              inputMode="decimal"
              className="min-h-[40px] w-32 rounded-md border border-border bg-card px-2 text-sm text-text-main"
            />
          </label>
        )}
        <button
          type="button"
          disabled={csvText === "" || busy}
          onClick={() => void handleDryRun()}
          className="inline-flex min-h-[40px] items-center rounded-md border border-brand-300 bg-brand-50 px-4 text-sm font-semibold text-brand-700 transition hover:bg-brand-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {phase === "dry-running" ? s.extDryRunning : s.extDryRunBtn}
        </button>
      </div>
      {def.kind === "products" && currency !== "BDT" && (
        <p className="mt-2 text-sm text-text-muted">
          {s.extRateNote}
        </p>
      )}
      {errorMessage && (
        <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700">
          {errorMessage}
        </p>
      )}

      {productReport && def.kind === "products" && (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-2/40 p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-4">
            {[
              [s.extSourceRows, productReport.totalSourceRows],
              [s.extMappedRows, productReport.mappedRowCount],
              [interpolate(s.extValidProducts, { count: productReport.productCount }), productReport.validCount],
              [s.extInvalidRows, productReport.invalidCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-border/60 bg-card p-3">
                <div className="text-caption font-semibold text-text-muted">{label}</div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <p className="mt-2.5 text-sm text-text-muted">
            {s.extCurrencyWord} <strong className="text-text-main">{productReport.currency.source}</strong>
            {productReport.currency.converted &&
              interpolate(s.extConvertedSuffix, { source: productReport.currency.source, rate: productReport.currency.exchangeRateToBdt ?? "" })}
            {" · "}{interpolate(s.extSkippedText, { count: productReport.skippedSourceRows.length })}
          </p>
          <NotesList notes={productReport.notes} />
          <UnmappedColumns columns={productReport.unmappedColumns} />
          {productReport.categoryWarnings.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5">
              <p className="text-sm font-semibold text-amber-800">{s.extCategoryWarnings}</p>
              <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-amber-800">
                {productReport.categoryWarnings.map((w, i) => (
                  <li key={i}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
          {productReport.skippedSourceRows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-card">
              <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-border/70">
                <thead>
                  <tr className="bg-surface-2 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                    <th>{s.extColSourceRow}</th>
                    <th>{s.extColRef}</th>
                    <th>{s.extColSkipReason}</th>
                  </tr>
                </thead>
                <tbody>
                  {productReport.skippedSourceRows.map((s, i) => (
                    <tr key={i} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="tabular-nums">{s.sourceRow}</td>
                      <td className="font-mono text-xs">{s.sourceRef}</td>
                      <td>{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {productReport.invalidRows.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-rose-100 bg-card">
              <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-border/70">
                <thead>
                  <tr className="bg-rose-50/80 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-rose-700">
                    <th>{s.extColSourceRow}</th>
                    <th>{s.extColRef}</th>
                    <th>{s.impColField}</th>
                    <th>{s.impColProblem}</th>
                  </tr>
                </thead>
                <tbody>
                  {productReport.invalidRows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="[&>td]:px-3 [&>td]:py-2">
                      <td className="tabular-nums">{r.sourceRow}</td>
                      <td className="font-mono text-xs">{r.sourceRef}</td>
                      <td className="font-mono text-xs">{r.field}</td>
                      <td>{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {productReport.invalidRows.length > 200 && (
                <p className="px-3 py-2 text-xs text-text-subtle">{s.extFirst200}</p>
              )}
            </div>
          )}
          <MappingTable mapping={productReport.mapping} />
        </div>
      )}

      {orderReport && def.kind === "orders" && (
        <div className="mt-4 rounded-lg border border-border/70 bg-surface-2/40 p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-4">
            {[
              [s.extSourceRows, orderReport.totalSourceRows],
              [s.extTotalOrders, orderReport.orderCount],
              [s.extReady, orderReport.readyCount],
              [s.extSkipped, orderReport.skippedCount],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-lg border border-border/60 bg-card p-3">
                <div className="text-caption font-semibold text-text-muted">{label}</div>
                <div className="mt-0.5 font-display text-lg font-bold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
          <NotesList notes={orderReport.notes} />
          <UnmappedColumns columns={orderReport.unmappedColumns} />
          <div className="mt-3 overflow-x-auto rounded-lg border border-border/70 bg-card">
            <table className="w-full text-sm [&_tbody_tr]:border-t [&_tbody_tr]:border-border/70">
              <thead>
                <tr className="bg-surface-2 [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:text-caption [&>th]:font-semibold [&>th]:text-text-muted">
                  <th>{s.extColSourceOrder}</th>
                  <th>{s.extColItems}</th>
                  <th>{s.impColStatus}</th>
                  <th>{s.extColReasonWarn}</th>
                </tr>
              </thead>
              <tbody>
                {orderReport.orders.map((o, i) => (
                  <tr key={i} className="[&>td]:px-3 [&>td]:py-2">
                    <td className="font-mono text-xs">#{o.sourceOrderId}</td>
                    <td className="tabular-nums">{o.itemCount}</td>
                    <td>{o.status === "ready" ? s.extReadyStatus : s.extSkippedStatus}</td>
                    <td className="text-xs">
                      {o.reasons.join(" ")}
                      {o.warnings.length > 0 && <span className="text-amber-700"> {o.warnings.join(" ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <MappingTable mapping={orderReport.mapping} />
        </div>
      )}

      {(productReport || orderReport) && phase !== "done" && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!readyToConfirm || busy}
            onClick={() => void handleConfirm()}
            className="brand-gradient inline-flex min-h-[44px] items-center rounded-md px-5 text-sm font-semibold text-white shadow-md transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "confirming" ? s.extImporting : s.extConfirmBtn}
          </button>
          <button
            type="button"
            onClick={downloadReport}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition hover:border-brand-300"
          >
            {s.extReportBtn}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={reset}
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition hover:border-brand-300"
          >
            {s.cancelBtn}
          </button>
        </div>
      )}
      {(productReport || orderReport) && !readyToConfirm && phase !== "done" && (
        <p className="mt-2 text-sm text-rose-600">{s.extNothingReady}</p>
      )}

      {phase === "done" && productResult && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3.5">
          <p className="text-sm leading-relaxed">
            <strong className="text-emerald-700">{interpolate(s.extProdDoneA, { count: productResult.createdProductCount })}</strong> {interpolate(s.extProdDoneB, { count: productResult.createdRowCount })} <strong>{s.extProdDoneDraft}</strong>{interpolate(s.extProdDoneC, { skipped: productResult.skippedRowCount, failed: productResult.failedRowCount })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {s.extReportBtn}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {s.extAnotherFile}
            </button>
          </div>
        </div>
      )}
      {phase === "done" && orderResult && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50/50 px-4 py-3.5">
          <p className="text-sm leading-relaxed">
            <strong className="text-emerald-700">{interpolate(s.extOrderDoneA, { count: orderResult.created })}</strong> {interpolate(s.extOrderDoneB, { skipped: orderResult.skipped, failed: orderResult.failed })}
          </p>
          {orderResult.outcomes.some((o) => o.status !== "created") && (
            <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-text-muted">
              {orderResult.outcomes
                .filter((o) => o.status !== "created")
                .map((o, i) => (
                  <li key={i}>
                    #{o.sourceOrderId}: {o.message ?? o.status}
                  </li>
                ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadReport}
              className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {s.extReportBtn}
            </button>
            <button
              type="button"
              onClick={reset}
              className="inline-flex min-h-[40px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium"
            >
              {s.extAnotherFile}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function FeedsCard() {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const [feeds, setFeeds] = useState<FeedInfo[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/imports/feeds");
        const data = (await res.json().catch(() => ({}))) as {
          data?: { feeds: FeedInfo[] };
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!res.ok || !data.data) {
          setError(data.error?.message ?? s.feedsLoadFail);
          return;
        }
        setFeeds(data.data.feeds);
      } catch {
        if (!cancelled) setError(s.feedsServerFail);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <section className="rounded-lg border border-border/70 bg-card p-4 shadow-card sm:p-5">
      <h3 className="font-display text-base font-semibold">{s.feedsTitle}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
        {s.feedsDescA} <span className="font-mono text-xs">X-Feed-Generated-At</span> {s.feedsDescB}
      </p>
      {error && <p className="mt-3 text-sm font-medium text-rose-600">{error}</p>}
      {feeds === null && !error && <p className="mt-3 text-sm text-text-muted">{s.feedsLoading}</p>}
      {feeds && (
        <div className="mt-3 space-y-2.5">
          {feeds.map((feed) => (
            <div
              key={feed.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-surface-2/40 px-3.5 py-3"
            >
              <span className="font-semibold">{feed.label}</span>
              {feed.templateBased && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 ring-1 ring-inset ring-amber-200">
                  {s.feedsTemplateBadge}
                </span>
              )}
              <span className="text-xs text-text-muted">{feed.format}</span>
              <span className="text-xs text-text-muted">
                {interpolate(s.feedsCounts, { products: feed.productCount, items: feed.itemCount })}
              </span>
              <code className="w-full break-all font-mono text-xs text-brand-700 sm:w-auto sm:flex-1">
                {origin}
                {feed.path}
              </code>
              <a
                href={feed.path}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold transition hover:border-brand-300"
              >
                {s.feedsOpen}
              </a>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${origin}${feed.path}`);
                  setCopied(feed.id);
                }}
                className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-card px-3 text-xs font-semibold transition hover:border-brand-300"
              >
                {copied === feed.id ? s.feedsCopied : s.feedsCopy}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ExternalImports() {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="font-display text-lg font-bold">{s.extSectionTitle}</h2>
        <span className="rounded-full bg-brand-50 px-2.5 py-1 font-mono text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-100">
          ADV-25
        </span>
      </div>
      <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-text-muted">
        {s.extSectionDescA} <strong>{s.extSectionDescStrong}</strong> {s.extSectionDescB}
      </p>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {SOURCES.map((def) => (
          <SourceCard key={def.id} def={def} />
        ))}
        <FeedsCard />
      </div>
    </div>
  );
}
