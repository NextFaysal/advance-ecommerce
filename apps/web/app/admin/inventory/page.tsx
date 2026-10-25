import Link from "next/link";
import { formatBdt } from "@advance-ecommerce/validators";
import { valuationPoisha } from "@/inventory/service";
import {
  LOW_STOCK_THRESHOLD,
  getVariantCostMapDb,
  getVariantProductMetaDb,
  listInventoryItemsDb,
} from "@/inventory/repository";
import { getSetting } from "@/lib/settings";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Admin inventory — reads the stock_movements ledger state from the DB
// (InventoryItem rows, src/inventory/repository.ts). Direct quantity
// edits are forbidden; stock changes only via movements (API below).
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
  const [costMap, metaMap, settingsThresholdRaw] = await Promise.all([
    getVariantCostMapDb(variantIds),
    getVariantProductMetaDb(variantIds),
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

  // Low stock BY NAME: availability is totalled per variant across
  // warehouses (a variant split across two godowns is one product
  // line), then compared against ITS effective threshold.
  const availableByVariant = new Map<string, number>();
  for (const i of items) {
    availableByVariant.set(i.variantId, (availableByVariant.get(i.variantId) ?? 0) + i.quantityAvailable);
  }
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
        <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-card">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                {["ভ্যারিয়েন্ট", "গুদাম", "হাতে আছে", "রিজার্ভ", "উপলব্ধ", "অবস্থা"].map((h) => (
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
                  <td className="px-4 py-3 font-mono font-semibold tabular-nums">{i.quantityAvailable}</td>
                  <td className="px-4 py-3">{stockBadge(i.quantityAvailable, thresholdFor(i.variantId).threshold)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card className="mt-5 shadow-card">
        <h2 className="text-h3">কম স্টক সতর্কতা ({low.length})</h2>
        {low.length === 0 ? (
          <p className="mt-2 text-small text-text-muted">কম স্টকের কোনো পণ্য নেই — সব ভ্যারিয়েন্টের মোট উপলব্ধ স্টক নিজ নিজ থ্রেশহোল্ডের উপরে।</p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {low.map((r) => (
              <li key={r.variantId} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
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
                  <span className="block text-caption text-text-subtle">
                    {r.sku ? `SKU: ${r.sku} · ` : ""}থ্রেশহোল্ড: {r.threshold}
                    {r.thresholdSource === "product" ? " (পণ্যের নিজস্ব)" : r.thresholdSource === "settings" ? " (সেটিংস)" : " (ডিফল্ট)"}
                  </span>
                </span>
                <Badge tone={r.quantityAvailable <= 0 ? "danger" : "warning"}>
                  {r.quantityAvailable <= 0 ? "স্টক শেষ" : `উপলব্ধ ${r.quantityAvailable}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        ডাটাবেস থেকে — API: GET/POST /api/v1/admin/inventory, POST /api/v1/admin/inventory/purchase-orders (RBAC + ledger, Prisma)। Adjustment-এর জন্য কারণ লাগে; স্টক বদলায় শুধু মুভমেন্টে।
      </p>
    </main>
  );
}
