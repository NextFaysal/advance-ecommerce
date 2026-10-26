"use client";

/**
 * Inventory depth panel (ADV-20) — mounted on the admin inventory
 * page inside the flag-gated "গভীর বিশ্লেষণ" card. Reads
 * GET /api/v1/admin/inventory/depth (ABC, dead stock, expiring
 * batches, batch overview, serial census — all computed server-side
 * from real rows) and triggers POST
 * /api/v1/admin/inventory/reorder/run ("এখন চালান"), which creates
 * DRAFT purchase orders only.
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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

const SKIP_LABEL: Record<string, string> = {
  open_po_exists: "খোলা PO আগেই আছে",
  no_supplier: "সাপ্লায়ার ঠিক নেই",
  supplier_not_found: "সাপ্লায়ার পাওয়া যায়নি",
  no_cost: "কস্ট জানা নেই",
  invalid_rule: "রুল অসম্পূর্ণ",
  no_warehouse: "গুদাম নেই",
  create_failed: "তৈরি ব্যর্থ",
};

function pct(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export default function InventoryDepthPanel() {
  const [report, setReport] = useState<DepthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [reordering, setReordering] = useState(false);
  const [reorderResult, setReorderResult] = useState<ReorderResult | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const load = useCallback(async (rangeDays: number) => {
    try {
      const res = await fetch(`/api/v1/admin/inventory/depth?days=${rangeDays}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? "রিপোর্ট লোড করা যায়নি");
      setReport(json.data as DepthReport);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "রিপোর্ট লোড করা যায়নি");
    }
  }, []);

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
      if (!res.ok) throw new Error(json?.error?.message ?? "রি-অর্ডার চালানো যায়নি");
      setReorderResult(json.data as ReorderResult);
    } catch (e) {
      setReorderError(e instanceof Error ? e.message : "রি-অর্ডার চালানো যায়নি");
    } finally {
      setReordering(false);
    }
  }

  if (error) return <p className="text-small text-rose-600">গভীর বিশ্লেষণ লোড করা যায়নি: {error}</p>;
  if (!report) return <p className="text-small text-text-muted">বিশ্লেষণ লোড হচ্ছে…</p>;

  return (
    <div className="space-y-6">
      {/* Serial census */}
      <div className="flex flex-wrap items-center gap-2 text-small text-text-muted">
        <span className="font-semibold text-text-main">সিরিয়াল / IMEI:</span>
        <Badge tone="success" dot>স্টকে {report.serials.inStock}টি</Badge>
        <Badge tone="info" dot>বিক্রি {report.serials.sold}টি</Badge>
        <Badge tone="warning" dot>ফেরত (নষ্ট) {report.serials.returned}টি</Badge>
        <span>মোট রেকর্ড {report.serials.total}টি — শুধু রিসিভে ধরা পড়া সিরিয়ালই গণনায় আসে।</span>
      </div>

      {/* ABC */}
      <section>
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-small font-semibold text-text-main">ABC বিশ্লেষণ (আয় অনুযায়ী)</h3>
          <span className="text-caption text-text-muted">
            A = প্রথম ৭০% আয় · B = পরের ২০% · C = বাকি · মোট আয় {formatBdt(report.abc.totalRevenuePoisha)}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-caption text-text-muted">
            সময়সীমা:
            {[30, 90, 180, 365].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-2 py-1 font-mono ${days === d ? "bg-brand-50 font-semibold text-brand-700" : "hover:bg-surface-2"}`}
              >
                {d} দিন
              </button>
            ))}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["A", "B", "C"] as const).map((c) => (
            <Badge key={c} tone={ABC_TONE[c]}>
              {c}: {report.abc.classSummary[c].variants}টি ভ্যারিয়েন্ট · {formatBdt(report.abc.classSummary[c].revenuePoisha)} ·{" "}
              {pct(report.abc.classSummary[c].shareBps)}
            </Badge>
          ))}
        </div>
        {report.abc.rows.length === 0 ? (
          <p className="mt-2 text-small text-text-muted">এই সময়সীমায় কোনো বিক্রি নেই।</p>
        ) : (
          <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border">
                  {["শ্রেণি", "পণ্য", "বিক্রি (টি)", "আয়", "অংশ"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 text-caption font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.abc.rows.slice(0, 100).map((r) => (
                  <tr key={r.variantId} className="border-t border-border first:border-t-0">
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
        )}
      </section>

      {/* Expiring batches */}
      <section>
        <h3 className="text-small font-semibold text-text-main">
          মেয়াদ শেষ হতে চলেছে (আগামী {report.expiring.warningDays} দিনে)
        </h3>
        {report.expiring.rows.length === 0 ? (
          <p className="mt-1 text-small text-text-muted">এই সময়ে মেয়াদ শেষ হওয়ার মতো কোনো ব্যাচ স্টকে নেই।</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {report.expiring.rows.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-small">
                <span className="font-mono font-semibold text-text-main">{b.batchCode}</span>
                <span>{b.productName} <span className="font-mono text-caption text-text-subtle">{b.sku}</span></span>
                <span className="text-text-muted">{b.warehouseName}{b.bin ? ` · বিন ${b.bin}` : ""} · হাতে {b.quantityOnHand}টি</span>
                <Badge tone={b.daysUntilExpiry !== null && b.daysUntilExpiry < 0 ? "danger" : "warning"} dot>
                  {b.daysUntilExpiry !== null && b.daysUntilExpiry < 0
                    ? `মেয়াদ শেষ (${Math.abs(b.daysUntilExpiry)} দিন আগে)`
                    : `আর ${b.daysUntilExpiry} দিন`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dead stock */}
      <section>
        <h3 className="text-small font-semibold text-text-main">
          ডেড স্টক ({report.deadStock.thresholdDays} দিনে বিক্রি হয়নি, তবু স্টক আছে)
        </h3>
        {report.deadStock.rows.length === 0 ? (
          <p className="mt-1 text-small text-text-muted">ডেড স্টক নেই — স্টক থাকা সব ভ্যারিয়েন্টের সাম্প্রতিক বিক্রি আছে।</p>
        ) : (
          <div className="mt-2 max-h-96 overflow-auto rounded-lg border border-border">
            <table className="w-full min-w-[560px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2 [&>th]:border-b [&>th]:border-border">
                  {["পণ্য", "স্টক", "আটকে থাকা মূল্য", "শেষ বিক্রি", "গুদাম / বিন"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 text-caption font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.deadStock.rows.slice(0, 100).map((r) => (
                  <tr key={r.variantId} className="border-t border-border first:border-t-0">
                    <td className="px-3 py-2">
                      <span className="block text-small font-medium text-text-main">{r.productName}</span>
                      <span className="block font-mono text-caption text-text-subtle">{r.sku}</span>
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">{r.stockOnHand}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {r.stockValuePoisha !== null ? formatBdt(r.stockValuePoisha) : "কস্ট নেই"}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {r.lastSaleAt ? new Date(r.lastSaleAt).toLocaleDateString("bn-BD") : "কখনো বিক্রি হয়নি"}
                    </td>
                    <td className="px-3 py-2 text-text-muted">
                      {r.warehouses.map((w) => `${w.warehouseName}: ${w.onHand}${w.bin ? ` (বিন ${w.bin})` : ""}`).join(" · ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Batch overview */}
      <section>
        <h3 className="text-small font-semibold text-text-main">ব্যাচ / লট (স্টকে আছে এমন)</h3>
        {report.batches.length === 0 ? (
          <p className="mt-1 text-small text-text-muted">
            কোনো ব্যাচ রেকর্ড নেই — রিসিভের সময় ব্যাচ কোড দিলে এখানে দেখা যাবে। ব্যাচ ছাড়া রিসিভ করা
            স্টক এই তালিকায় আসে না (তা অনট্র্যাকড, শূন্য নয়)।
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {report.batches.map((b) => (
              <li key={b.batchId} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border px-3 py-2 text-small">
                <span className="font-mono font-semibold text-text-main">{b.batchCode}</span>
                <span>{b.productName} <span className="font-mono text-caption text-text-subtle">{b.sku}</span></span>
                <span className="text-text-muted">
                  {b.warehouseName}{b.bin ? ` · বিন ${b.bin}` : ""} · হাতে {b.quantityOnHand}টি
                  {b.expiryDate ? ` · মেয়াদ ${new Date(b.expiryDate).toLocaleDateString("bn-BD")}` : " · মেয়াদ রেকর্ড নেই"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Auto-reorder */}
      <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-small font-semibold text-text-main">অটো রি-অর্ডার</h3>
          <span className="text-caption text-text-muted">
            রি-অর্ডার পয়েন্টে পৌঁছানো ভ্যারিয়েন্টের জন্য শুধু খসড়া (DRAFT) ক্রয় আদেশ তৈরি হয় —
            সাপ্লায়ারের কাছে কিছুই পাঠানো হয় না। রুল: সেটিংস inventory.reorder.*
          </span>
          <Button size="sm" className="ml-auto" onClick={() => void runReorder()} loading={reordering}>
            এখন চালান
          </Button>
        </div>
        {reorderError ? (
          <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-small text-rose-700">{reorderError}</p>
        ) : null}
        {reorderResult ? (
          <div className="mt-2 text-small">
            <p className="text-text-muted">
              বিবেচনায় এসেছে {reorderResult.consideredCount}টি ভ্যারিয়েন্ট · তৈরি হয়েছে{" "}
              {reorderResult.createdPos.length}টি খসড়া PO · বাদ গেছে {reorderResult.skipped.length}টি
            </p>
            {reorderResult.createdPos.map((po) => (
              <p key={po.purchaseOrderId} className="mt-1 text-emerald-700">
                খসড়া PO তৈরি: {po.supplierName} — {po.lines.length}টি লাইন (<span className="font-mono">{po.purchaseOrderId}</span>)
                — উপরের ক্রয় আদেশ তালিকা থেকে রিভিউ করুন।
              </p>
            ))}
            {reorderResult.skipped.length > 0 ? (
              <ul className="mt-1 space-y-0.5 text-text-muted">
                {reorderResult.skipped.map((s) => (
                  <li key={`${s.variantId}-${s.reason}`}>
                    <span className="font-mono">{s.sku}</span> — {SKIP_LABEL[s.reason] ?? s.reason}
                    {s.detail ? ` (${s.detail})` : ""}
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
