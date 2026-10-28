"use client";

/**
 * Inventory depth panel (ADV-20) — mounted on the admin inventory
 * page inside the flag-gated in-depth analysis card. Reads
 * GET /api/v1/admin/inventory/depth (ABC, dead stock, expiring
 * batches, batch overview, serial census — all computed server-side
 * from real rows) and triggers POST
 * /api/v1/admin/inventory/reorder/run ("run now"), which creates
 * DRAFT purchase orders only.
 *
 * Language (doc 30, slice L5-D): every string comes from
 * ./strings (INVENTORY_STRINGS) resolved via useLocale(); dates use
 * intlLocale(locale).
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { DataTableSkeleton } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { INVENTORY_STRINGS } from "./strings";

interface AbcRow {
  variantId: string;
  sku: string;
  productName: string;
  unitsSold: number;
  revenuePoisha: number;
  shareBps: number;
  abcClass: "A" | "B" | "C";
}
interface DeadRow {
  variantId: string;
  sku: string;
  productName: string;
  stockOnHand: number;
  stockValuePoisha: number | null;
  lastSaleAt: string | null;
  warehouses: { warehouseName: string; onHand: number; bin: string | null }[];
}
interface BatchRow {
  batchId: string;
  batchCode: string;
  sku: string;
  productName: string;
  warehouseName: string;
  bin: string | null;
  quantityOnHand: number;
  expiryDate: string | null;
  daysUntilExpiry: number | null;
}
interface DepthReport {
  abc: {
    rangeDays: number;
    totalRevenuePoisha: number;
    rows: AbcRow[];
    classSummary: Record<"A" | "B" | "C", { variants: number; revenuePoisha: number; shareBps: number }>;
  };
  deadStock: { thresholdDays: number; rows: DeadRow[] };
  expiring: { warningDays: number; rows: BatchRow[] };
  batches: BatchRow[];
  serials: { inStock: number; sold: number; returned: number; total: number };
}
interface ReorderResult {
  consideredCount: number;
  createdPos: { purchaseOrderId: string; supplierName: string; lines: unknown[] }[];
  skipped: { variantId: string; sku: string; reason: string; detail?: string }[];
}

const ABC_TONE: Record<"A" | "B" | "C", "success" | "warning" | "neutral"> = {
  A: "success",
  B: "warning",
  C: "neutral",
};

function pct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export default function InventoryDepthPanel() {
  const { locale } = useLocale();
  const s = pick(locale, INVENTORY_STRINGS);
  const [report, setReport] = useState<DepthReport | null>(null);
  // ADV-27: cost fields arrive null + meta.costMasked when the
  // viewer lacks products.edit_cost_price — render "—" (hidden),
  // never the no-cost label (which would falsely claim no cost is
  // recorded).
  const [costMasked, setCostMasked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [reordering, setReordering] = useState(false);
  const [reorderResult, setReorderResult] = useState<ReorderResult | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const SKIP_LABEL: Record<string, string> = {
    open_po_exists: s.skipOpenPo,
    no_supplier: s.skipNoSupplier,
    supplier_not_found: s.skipSupplierNotFound,
    no_cost: s.skipNoCost,
    invalid_rule: s.skipInvalidRule,
    no_warehouse: s.skipNoWarehouse,
    create_failed: s.skipCreateFailed,
  };

  const load = useCallback(async (rangeDays: number) => {
    try {
      const res = await fetch(`/api/v1/admin/inventory/depth?days=${rangeDays}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? s.reportLoadFailed);
      setReport(json.data as DepthReport);
      setCostMasked(json?.meta?.costMasked === true);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : s.reportLoadFailed);
    }
  }, [s.reportLoadFailed]);

  useEffect(() => {
    void load(days);
  }, [load, days]);

  async function runReorder() {
    if (reordering) return;
    setReordering(true);
    setReorderError(null);
    setReorderResult(null);
    try {
      const res = await fetch("/api/v1/admin/inventory/reorder/run", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? s.reorderRunFailed);
      setReorderResult(json.data as ReorderResult);
    } catch (e) {
      setReorderError(e instanceof Error ? e.message : s.reorderRunFailed);
    } finally {
      setReordering(false);
    }
  }

  if (error) return <p className="text-small text-danger">{interpolate(s.depthLoadFailed, { error })}</p>;
  if (!report)
    return (
      <div role="status" aria-label={s.analysisLoading}>
        <DataTableSkeleton columns={4} rows={4} density="compact" />
        <p className="mt-3 text-small text-text-muted">{s.analysisLoading}</p>
      </div>
    );

  return (
    <div className="space-y-6">
      {/* Serial census */}
      <div className="flex flex-wrap items-center gap-2 text-small text-text-muted">
        <span className="font-semibold text-text-main">{s.serialLabel}</span>
        <Badge tone="success" dot>{interpolate(s.serialInStock, { count: report.serials.inStock })}</Badge>
        <Badge tone="info" dot>{interpolate(s.serialSold, { count: report.serials.sold })}</Badge>
        <Badge tone="warning" dot>{interpolate(s.serialReturned, { count: report.serials.returned })}</Badge>
        <span>{interpolate(s.serialTotalNote, { count: report.serials.total })}</span>
      </div>

      {/* ABC */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-small font-semibold text-text-main">{s.abcTitle}</h3>
          <span className="text-caption text-text-muted">
            {interpolate(s.abcNote, { total: formatBdt(report.abc.totalRevenuePoisha) })}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-caption text-text-muted">
            {s.rangeLabel}
            {[30, 90, 180, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-lg px-2 py-1 font-mono transition duration-fast ease-smooth ${days === d ? "bg-brand-soft font-semibold text-brand-700" : "hover:bg-surface-2"}`}
              >
                {interpolate(s.daysOption, { days: d })}
              </button>
            ))}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["A", "B", "C"] as const).map((c) => (
            <Badge key={c} tone={ABC_TONE[c]}>
              {c}: {interpolate(s.abcBadge, { count: report.abc.classSummary[c].variants })} · {formatBdt(report.abc.classSummary[c].revenuePoisha)} ·{" "}
              {pct(report.abc.classSummary[c].shareBps)}
            </Badge>
          ))}
        </div>
        {report.abc.rows.length === 0 ? (
          <div className="mt-2 rounded-xl border border-dashed border-border-strong bg-surface-2/40 px-4 py-3">
            <p className="text-small font-semibold text-text-main">{s.abcEmptyTitle}</p>
            <p className="mt-0.5 text-small text-text-muted">{s.abcEmptyDesc}</p>
          </div>
        ) : (
          <>
          <div className="mt-2 hidden max-h-96 overflow-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2/80">
                  {[s.colClass, s.colProduct, s.colUnitsSold, s.colRevenue, s.colShare].map((h) => (
                    <th key={h} scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-2 text-xs font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.abc.rows.slice(0, 100).map((r) => (
                  <tr key={r.variantId} className="border-t border-border/60 transition duration-fast ease-smooth first:border-t-0 hover:bg-brand-soft/60">
                    <td className="px-3 py-2"><Badge tone={ABC_TONE[r.abcClass]}>{r.abcClass}</Badge></td>
                    <td className="px-3 py-2">
                      <span className="block text-small font-medium text-text-main">{r.productName}</span>
                      <span className="block font-mono text-caption text-text-subtle">{r.sku}</span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{r.unitsSold}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatBdt(r.revenuePoisha)}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{pct(r.shareBps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-3 md:hidden">
            {report.abc.rows.slice(0, 100).map((r) => (
              <article key={`m-${r.variantId}`} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-small font-medium text-text-main">{r.productName}</span>
                    <span className="block font-mono text-caption text-text-subtle">{r.sku}</span>
                  </span>
                  <Badge tone={ABC_TONE[r.abcClass]}>{r.abcClass}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                  <span><span className="block text-caption text-text-subtle">{s.colUnitsSold}</span><span className="tnum font-mono font-semibold">{r.unitsSold}</span></span>
                  <span><span className="block text-caption text-text-subtle">{s.colRevenue}</span><span className="tnum font-mono font-semibold">{formatBdt(r.revenuePoisha)}</span></span>
                  <span><span className="block text-caption text-text-subtle">{s.colShare}</span><span className="tnum font-mono font-semibold">{pct(r.shareBps)}</span></span>
                </div>
              </article>
            ))}
          </div>
          </>
        )}
      </section>

      {/* Expiring batches */}
      <section>
        <h3 className="font-display text-small font-semibold text-text-main">
          {interpolate(s.expiringTitle, { days: report.expiring.warningDays })}
        </h3>
        {report.expiring.rows.length === 0 ? (
          <div className="mt-1 rounded-xl border border-dashed border-border-strong bg-surface-2/40 px-4 py-3">
            <p className="text-small font-semibold text-text-main">{s.expiringEmptyTitle}</p>
            <p className="mt-0.5 text-small text-text-muted">{s.expiringEmptyDesc}</p>
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {report.expiring.rows.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card px-3 py-2 text-small shadow-xs">
                <span className="font-mono font-semibold text-text-main">{b.batchCode}</span>
                <span>{b.productName} <span className="font-mono text-caption text-text-subtle">{b.sku}</span></span>
                <span className="text-text-muted">{b.warehouseName}{b.bin ? ` · ${interpolate(s.binText, { bin: b.bin })}` : ""} · {interpolate(s.onHandText, { count: b.quantityOnHand })}</span>
                <Badge tone={b.daysUntilExpiry !== null && b.daysUntilExpiry < 0 ? "danger" : "warning"} dot>
                  {b.daysUntilExpiry !== null && b.daysUntilExpiry < 0
                    ? interpolate(s.expiredBadge, { days: Math.abs(b.daysUntilExpiry) })
                    : b.daysUntilExpiry !== null
                      ? interpolate(s.daysLeftBadge, { days: b.daysUntilExpiry })
                      : s.noExpiryBadge}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dead stock */}
      <section>
        <h3 className="font-display text-small font-semibold text-text-main">
          {interpolate(s.deadTitle, { days: report.deadStock.thresholdDays })}
        </h3>
        {costMasked && (
          <p className="mt-1 text-small text-text-muted">
            {s.deadCostMasked}
          </p>
        )}
        {report.deadStock.rows.length === 0 ? (
          <div className="mt-1 rounded-xl border border-dashed border-border-strong bg-surface-2/40 px-4 py-3">
            <p className="text-small font-semibold text-text-main">{s.deadEmptyTitle}</p>
            <p className="mt-0.5 text-small text-text-muted">{s.deadEmptyDesc}</p>
          </div>
        ) : (
          <>
          <div className="mt-2 hidden max-h-96 overflow-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2/80">
                  {[s.colProduct, s.colStock, s.colStuckValue, s.colLastSale, s.colWarehouseBin].map((h) => (
                    <th key={h} scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-2 text-xs font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.deadStock.rows.slice(0, 100).map((r) => (
                  <tr key={r.variantId} className="border-t border-border/60 transition duration-fast ease-smooth first:border-t-0 hover:bg-brand-soft/60">
                    <td className="px-3 py-2">
                      <span className="block text-small font-medium text-text-main">{r.productName}</span>
                      <span className="block font-mono text-caption text-text-subtle">{r.sku}</span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{r.stockOnHand}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {costMasked
                        ? "—"
                        : r.stockValuePoisha !== null
                          ? formatBdt(r.stockValuePoisha)
                          : s.noCost}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {r.lastSaleAt ? new Date(r.lastSaleAt).toLocaleDateString(intlLocale(locale)) : s.neverSold}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {r.warehouses.map((w) => `${w.warehouseName}: ${w.onHand}${w.bin ? ` ${interpolate(s.binParen, { bin: w.bin })}` : ""}`).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-3 md:hidden">
            {report.deadStock.rows.slice(0, 100).map((r) => (
              <article key={`m-${r.variantId}`} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <span className="block truncate text-small font-medium text-text-main">{r.productName}</span>
                <span className="block font-mono text-caption text-text-subtle">{r.sku}</span>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border/60 pt-3 text-center">
                  <span><span className="block text-caption text-text-subtle">{s.colStock}</span><span className="tnum font-mono font-semibold">{r.stockOnHand}</span></span>
                  <span><span className="block text-caption text-text-subtle">{s.colStuckValue}</span><span className="tnum font-mono font-semibold">{costMasked ? "—" : r.stockValuePoisha !== null ? formatBdt(r.stockValuePoisha) : s.noCost}</span></span>
                </div>
                <p className="mt-2 text-caption text-text-muted">{s.colLastSale}: {r.lastSaleAt ? new Date(r.lastSaleAt).toLocaleDateString(intlLocale(locale)) : s.neverSold}</p>
              </article>
            ))}
          </div>
          </>
        )}
      </section>

      {/* Batch overview */}
      <section>
        <h3 className="font-display text-small font-semibold text-text-main">{s.batchTitle}</h3>
        {report.batches.length === 0 ? (
          <div className="mt-1 rounded-xl border border-dashed border-border-strong bg-surface-2/40 px-4 py-3">
            <p className="text-small font-semibold text-text-main">{s.batchEmptyTitle}</p>
            <p className="mt-0.5 text-small text-text-muted">{s.batchEmptyDesc}</p>
          </div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {report.batches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border/60 bg-card px-3 py-2 text-small shadow-xs">
                <span className="font-mono font-semibold text-text-main">{b.batchCode}</span>
                <span>{b.productName} <span className="font-mono text-caption text-text-subtle">{b.sku}</span></span>
                <span className="text-text-muted">
                  {b.warehouseName}{b.bin ? ` · ${interpolate(s.binText, { bin: b.bin })}` : ""} · {interpolate(s.onHandText, { count: b.quantityOnHand })}
                  {b.expiryDate ? ` · ${interpolate(s.expiryText, { date: new Date(b.expiryDate).toLocaleDateString(intlLocale(locale)) })}` : ` · ${s.noExpiryRecord}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Auto-reorder */}
      <section className="rounded-2xl border border-border/60 bg-surface-2/50 px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-display text-small font-semibold text-text-main">{s.reorderTitle}</h3>
          <span className="text-caption text-text-muted">
            {s.reorderNote}
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void runReorder()} loading={reordering}>
            {s.runNow}
          </Button>
        </div>
        {reorderError ? (
          <p className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-small text-danger">{reorderError}</p>
        ) : null}
        {reorderResult ? (
          <div className="mt-2 text-small">
            <p className="text-text-muted">
              {interpolate(s.reorderSummary, {
                considered: reorderResult.consideredCount,
                created: reorderResult.createdPos.length,
                skipped: reorderResult.skipped.length,
              })}
            </p>
            {reorderResult.createdPos.map((po) => (
              <p key={po.purchaseOrderId} className="mt-1 text-success-solid">
                {interpolate(s.draftPoCreated, {
                  supplier: po.supplierName,
                  lines: po.lines.length,
                  id: po.purchaseOrderId,
                })}
              </p>
            ))}
            {reorderResult.skipped.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-text-muted">
                {reorderResult.skipped.map((sk) => (
                  <li key={`${sk.variantId}-${sk.reason}`}>
                    <span className="font-mono">{sk.sku}</span> — {SKIP_LABEL[sk.reason] ?? sk.reason}
                    {sk.detail ? ` (${sk.detail})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
