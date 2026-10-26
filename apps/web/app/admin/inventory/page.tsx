import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { valuationPoisha } from "@/inventory/service";
import {
  LOW_STOCK_THRESHOLD,
  getVariantCostMapDb,
  getVariantProductMetaDb,
  getVariantStockCacheDb,
  listInventoryItemsDb,
} from "@/inventory/repository";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import PurchaseOrdersPanel from "./purchase-orders-panel";

// Admin inventory — reads the stock_movements ledger state from the DB
// (InventoryItem rows, src/inventory/repository.ts). Direct quantity
// edits are forbidden; stock changes only via movements (API below).
//
// Availability headline (doc 18, F1): per variant, the headline number
// is ProductVariant.stock — the cache the order funnel claims against
// (getVariantStockCacheDb). Σ InventoryItem.quantityAvailable
// double-subtracts order reservations (the order seam mirrors the
// post-claim cache into quantityOnHand AND increments
// quantityReserved), so the ledger sum can read lower than what
// checkout will sell. The warehouse table below is the secondary,
// per-godown breakdown; low-stock is judged on the headline.
//
// Presentation (Design v3 consistency pass): PageHeader + token table
// system + status badges + designed empty states, aligned with the
// products/customers pages. Data reads and computations unchanged.
export const dynamic = "force-dynamic";

function stockBadge(available: number, threshold: number) {
  if (available <= 0) return <Badge tone="danger">স্টক শেষ</Badge>;
  if (available <= threshold) return <Badge tone="warning">কম স্টক</Badge>;
  return <Badge tone="success">ঠিক আছে</Badge>;
}

interface LowStockNamed {
  variantId: string;
  sku: string | null;
  productId: string | null;
  productTitleBn: string | null;
  quantityAvailable: number;
  threshold: number;
  thresholdSource: "product" | "settings" | "default";
}

export default async function AdminInventoryPage() {
  const items = await listInventoryItemsDb();
  const variantIds = items.map((i) => i.variantId);
  const [costMap, metaMap, stockCacheMap, settingsThresholdRaw] = await Promise.all([
    getVariantCostMapDb(variantIds),
    getVariantProductMetaDb(variantIds),
    getVariantStockCacheDb(variantIds),
    getSetting("inventory.low_stock_threshold").catch(() => null),
  ]);
  const costedItems = items.filter((i) => costMap.has(i.variantId));
  const valuation = valuationPoisha(costedItems, Object.fromEntries(costMap));
  const missingCost = items.length - costedItems.length;

  // Effective low-stock threshold (Wave 14-2): per-product override →
  // Settings `inventory.low_stock_threshold` → the built-in default.
  const settingsThreshold = (() => {
    if (settingsThresholdRaw === null) return null;
    const n = Number(settingsThresholdRaw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  })();
  const thresholdFor = (variantId: string): { threshold: number; source: LowStockNamed["thresholdSource"] } => {
    const override = metaMap.get(variantId)?.lowStockThreshold;
    if (override !== null && override !== undefined) return { threshold: override, source: "product" };
    if (settingsThreshold !== null) return { threshold: settingsThreshold, source: "settings" };
    return { threshold: LOW_STOCK_THRESHOLD, source: "default" };
  };

  // Low stock BY NAME: availability is taken per variant (a variant
  // split across two godowns is one product line), then compared
  // against ITS effective threshold. The per-variant figure is the
  // CANONICAL cache (ProductVariant.stock — what the order funnel
  // claims against), NOT the sum of the warehouse rows: that sum
  // double-subtracts reservations and can disagree with checkout
  // (doc 18, F1). The ledger sum is only a fallback for a variant
  // whose ProductVariant row no longer exists.
  const ledgerAvailableByVariant = new Map<string, number>();
  for (const i of items) {
    ledgerAvailableByVariant.set(i.variantId, (ledgerAvailableByVariant.get(i.variantId) ?? 0) + i.quantityAvailable);
  }
  const availableByVariant = new Map<string, number>();
  for (const [variantId, ledgerTotal] of ledgerAvailableByVariant) {
    availableByVariant.set(variantId, stockCacheMap.get(variantId) ?? ledgerTotal);
  }
  const headlineFor = (variantId: string, rowAvailable: number): number =>
    stockCacheMap.get(variantId) ?? rowAvailable;
  const low: LowStockNamed[] = [...availableByVariant.entries()]
    .map(([variantId, quantityAvailable]) => {
      const { threshold, source } = thresholdFor(variantId);
      const meta = metaMap.get(variantId);
      return {
        variantId,
        sku: meta?.sku ?? null,
        productId: meta?.productId ?? null,
        productTitleBn: meta?.productTitleBn ?? null,
        quantityAvailable,
        threshold,
        thresholdSource: source,
      };
    })
    .filter((r) => r.quantityAvailable <= r.threshold)
    .sort((a, b) => a.quantityAvailable - b.quantityAvailable);
  return (
    <main className="min-w-0">
      <PageHeader
        title="ইনভেন্টরি"
        description={`স্টক লেজার থেকে আসল ডেটা — মোট ${items.length}টি আইটেম (ভ্যারিয়েন্ট × গুদাম)। সরাসরি সংখ্যা বদলানো যায় না; স্টক বদলায় শুধু মুভমেন্টে।`}
      />

      {/* Summary strip */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="shadow-card">
          <p className="text-caption font-medium text-text-muted">মোট মূল্য (কস্ট)</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{formatBdt(valuation)}</p>
          {missingCost > 0 ? (
            <p className="mt-1 text-caption text-text-muted">{missingCost}টি আইটেমের কস্ট নেই — মূল্যায়নে ধরা হয়নি</p>
          ) : null}
        </Card>
        <Card className="shadow-card">
          <p className="text-caption font-medium text-text-muted">মোট আইটেম</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{items.length}</p>
          <p className="mt-1 text-caption text-text-muted">ভ্যারিয়েন্ট × গুদাম হিসেবে</p>
        </Card>
        <Card className="shadow-card">
          <p className="text-caption font-medium text-text-muted">কম স্টক সতর্কতা</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{low.length}</p>
          <p className="mt-1 text-caption text-text-muted">
            প্রতিটি পণ্যের নিজস্ব থ্রেশহোল্ড; না থাকলে ডিফল্ট {settingsThreshold ?? LOW_STOCK_THRESHOLD}
          </p>
        </Card>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z" />
              <path d="M6 18h12" /><path d="M6 14h12" /><path d="M10 22v-4h4v4" />
            </svg>
          </span>
          <h2 className="mt-4 text-h3">ইনভেন্টরিতে কোনো আইটেম নেই</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            পণ্যের ভ্যারিয়েন্টে স্টক মুভমেন্ট এলেই এখানে আইটেম দেখা যাবে।
          </p>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-small font-semibold text-text-main">গুদাম অনুযায়ী বিবরণ (সেকেন্ডারি)</p>
          <p className="mb-3 max-w-3xl text-caption leading-relaxed text-text-muted">
            প্রতি গুদামের লেজার হিসাব নিচে — কিন্তু অর্ডার/চেকআউট যে সংখ্যা দেখে বিক্রি করে, তা হলো
            <span className="font-semibold text-text-main"> "মোট উপলব্ধ (অর্ডারের হিসাব)"</span> কলামের সংখ্যা
            (ভ্যারিয়েন্টের ক্যাশ স্টক)। রিজার্ভ করা অর্ডারের কারণে গুদামের "উপলব্ধ" যোগফল এর চেয়ে কম দেখাতে পারে।
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                  {["ভ্যারিয়েন্ট", "গুদাম", "হাতে আছে", "রিজার্ভ", "এই গুদামে উপলব্ধ", "মোট উপলব্ধ (অর্ডারের হিসাব)", "অবস্থা"].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={`${i.variantId}-${i.warehouseId}`} className="border-t border-border transition motion-fast first:border-t-0 hover:bg-surface-2/70">
                    <td className="px-4 py-3 font-mono text-small">{i.variantId}</td>
                    <td className="px-4 py-3 text-text-muted">{i.warehouseId}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityOnHand}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityReserved}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityAvailable}</td>
                    <td className="px-4 py-3 font-mono font-semibold tabular-nums">{stockCacheMap.get(i.variantId) ?? "—"}</td>
                    <td className="px-4 py-3">{stockBadge(headlineFor(i.variantId, i.quantityAvailable), thresholdFor(i.variantId).threshold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Card className="mt-5 overflow-hidden shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${
              low.length > 0
                ? "bg-amber-50 text-amber-600 ring-amber-100"
                : "bg-emerald-50 text-emerald-600 ring-emerald-100"
            }`}
          >
            <Icon name={low.length > 0 ? "alert" : "check"} size={20} />
          </span>
          <h2 className="text-h3">কম স্টক সতর্কতা</h2>
          <Badge tone={low.length > 0 ? "warning" : "success"} dot>
            {low.length}টি পণ্য
          </Badge>
        </div>
        {low.length === 0 ? (
          <p className="mt-3 text-small leading-relaxed text-text-muted">কম স্টকের কোনো পণ্য নেই — সব ভ্যারিয়েন্টের মোট উপলব্ধ স্টক নিজ নিজ থ্রেশহোল্ডের উপরে।</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {low.map((r) => {
              const out = r.quantityAvailable <= 0;
              return (
                <li
                  key={r.variantId}
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border-l-4 px-3.5 py-3 transition motion-fast ${
                    out
                      ? "border-rose-400 bg-rose-50/60 hover:bg-rose-50"
                      : "border-amber-400 bg-amber-50/50 hover:bg-amber-50/80"
                  }`}
                >
                  <span className="min-w-0">
                    {r.productId ? (
                      <Link
                        href={`/admin/products/${r.productId}`}
                        className="block truncate text-small font-semibold text-text-main underline-offset-2 hover:text-brand-700 hover:underline"
                      >
                        {r.productTitleBn ?? r.variantId}
                      </Link>
                    ) : (
                      <span className="block truncate font-mono text-small">{r.variantId}</span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-text-subtle">
                      <span>
                        {r.sku ? `SKU: ${r.sku} · ` : ""}থ্রেশহোল্ড: {r.threshold}
                      </span>
                      <Badge tone={r.thresholdSource === "product" ? "brand" : r.thresholdSource === "settings" ? "info" : "neutral"}>
                        {r.thresholdSource === "product" ? "পণ্যের নিজস্ব" : r.thresholdSource === "settings" ? "সেটিংস" : "ডিফল্ট"}
                      </Badge>
                    </span>
                  </span>
                  <Badge tone={out ? "danger" : "warning"} dot>
                    {out ? "স্টক শেষ" : `উপলব্ধ ${r.quantityAvailable}`}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card className="mt-5 shadow-card">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100"
          >
            <Icon name="truck" size={20} />
          </span>
          <h2 className="text-h3">ক্রয় আদেশ ও পণ্য গ্রহণ</h2>
        </div>
        <p className="mt-2 max-w-3xl text-small leading-relaxed text-text-muted">
          সাপ্লায়ারের চালান এলে এখান থেকে রিসিভ করুন — প্রতিটি রিসিভ স্টক লেজারে
          PURCHASE_RECEIVE মুভমেন্ট হিসেবে জমা হয় (অর্ডারের রেফারেন্সসহ), আংশিক রিসিভ
          বারবার করা যায়, আর অর্ডারের বেশি রিসিভ সিস্টেম নেবে না। অর্ডার সম্পূর্ণ
          রিসিভ হলে ERP জার্নালে ক্রয়-প্রাপ্তির পোস্টিং হয় (module.erp_lite চালু থাকলে)।
        </p>
        <div className="mt-4">
          <PurchaseOrdersPanel />
        </div>
      </Card>

      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        ডাটাবেস থেকে — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders,
        GET /api/v1/admin/purchase-orders/[id], POST /api/v1/admin/purchase-orders/[id]/receive (RBAC + ledger, Prisma)। Adjustment-এর জন্য কারণ লাগে; স্টক বদলায় শুধু মুভমেন্টে।
      </p>
    </main>
  );
}
