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
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { INVENTORY_STRINGS, type InventoryStrings } from "./strings";
import { PageHeader } from "@/admin-shell/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import PurchaseOrdersPanel from "./purchase-orders-panel";
import InventoryDepthPanel from "./depth-panel";

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

function stockBadge(available: number, threshold: number, s: InventoryStrings, outOfStock: string) {
  if (available <= 0) return <Badge tone="danger">{outOfStock}</Badge>;
  if (available <= threshold) return <Badge tone="warning">{s.badgeLowStock}</Badge>;
  return <Badge tone="success">{s.badgeOk}</Badge>;
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
  const locale = await getRequestLocale();
  const s = pick(locale, INVENTORY_STRINGS);
  const ct = pick(locale, COMMON_STRINGS);
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
    <main className="min-w-0 space-y-6">
      <PageHeader
        title={s.title}
        subtitle={interpolate(s.description, { count: items.length })}
      />

      {/* Summary strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-caption font-medium text-text-muted">{s.totalValueCost}</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{formatBdt(valuation)}</p>
          {missingCost > 0 ? (
            <p className="mt-1 text-caption text-text-muted">{interpolate(s.missingCostNote, { count: missingCost })}</p>
          ) : null}
        </Card>
        <Card>
          <p className="text-caption font-medium text-text-muted">{s.totalItems}</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{items.length}</p>
          <p className="mt-1 text-caption text-text-muted">{s.itemsCaption}</p>
        </Card>
        <Card>
          <p className="text-caption font-medium text-text-muted">{s.lowStockAlerts}</p>
          <p className="mt-1 font-mono text-h3 font-bold tabular-nums">{low.length}</p>
          <p className="mt-1 text-caption text-text-muted">
            {interpolate(s.lowStockCaption, { threshold: settingsThreshold ?? LOW_STOCK_THRESHOLD })}
          </p>
        </Card>
      </div>

      {items.length === 0 ? (
        <EmptyState title={s.emptyTitle} description={s.emptyBody} />
      ) : (
        <div>
          <p className="mb-2 text-small font-semibold text-text-main">{s.breakdownTitle}</p>
          <p className="mb-3 max-w-3xl text-caption leading-relaxed text-text-muted">
            {s.breakdownNoteBefore}
            <span className="font-semibold text-text-main"> {s.breakdownNoteEmphasis}</span> {s.breakdownNoteAfter}
          </p>
          <div className="hidden overflow-x-auto rounded-2xl border border-border/60 bg-card shadow-xs md:block">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-surface-2/80 text-left">
                  {[s.colVariant, s.colWarehouse, s.colOnHand, s.colReserved, s.colAvailableHere, s.colTotalAvailable, ct.status].map((h) => (
                    <th key={h} scope="col" className="sticky top-0 z-10 bg-surface-2 px-4 py-3 text-xs font-semibold text-text-muted">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={`${i.variantId}-${i.warehouseId}`} className="border-t border-border/60 transition duration-fast ease-smooth first:border-t-0 hover:bg-brand-soft/60">
                    <td className="px-4 py-3 font-mono text-small">{i.variantId}</td>
                    <td className="px-4 py-3 text-text-muted">{i.warehouseId}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityOnHand}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityReserved}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{i.quantityAvailable}</td>
                    <td className="px-4 py-3 font-mono font-semibold tabular-nums">{stockCacheMap.get(i.variantId) ?? "—"}</td>
                    <td className="px-4 py-3">{stockBadge(headlineFor(i.variantId, i.quantityAvailable), thresholdFor(i.variantId).threshold, s, ct.outOfStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile card view (under md) — same warehouse rows, key fields only. */}
          <div className="space-y-3 md:hidden">
            {items.map((i) => (
              <article key={`m-${i.variantId}-${i.warehouseId}`} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-small font-medium">{i.variantId}</span>
                  {stockBadge(headlineFor(i.variantId, i.quantityAvailable), thresholdFor(i.variantId).threshold, s, ct.outOfStock)}
                </div>
                <p className="mt-1 text-small text-text-muted">{i.warehouseId}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center">
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colOnHand}</span>
                    <span className="tnum font-mono font-semibold">{i.quantityOnHand}</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colReserved}</span>
                    <span className="tnum font-mono font-semibold">{i.quantityReserved}</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">{s.colTotalAvailable}</span>
                    <span className="tnum font-mono font-semibold">{stockCacheMap.get(i.variantId) ?? "—"}</span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${
              low.length > 0
                ? "bg-warning-soft text-warning-solid ring-warning-solid/20"
                : "bg-success-soft text-success-solid ring-success-solid/20"
            }`}
          >
            <Icon name={low.length > 0 ? "alert" : "check"} size={20} />
          </span>
          <h2 className="font-display text-h3 font-semibold">{s.lowStockAlerts}</h2>
          <Badge tone={low.length > 0 ? "warning" : "success"} dot>
            {interpolate(s.productsCount, { count: low.length })}
          </Badge>
        </div>
        {low.length === 0 ? (
          <p className="mt-3 text-small leading-relaxed text-text-muted">{s.lowStockNone}</p>
        ) : (
          <ul className="mt-4 space-y-2">
            {low.map((r) => {
              const out = r.quantityAvailable <= 0;
              return (
                <li
                  key={r.variantId}
                  className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border-l-4 px-3.5 py-3 transition duration-fast ease-smooth ${
                    out
                      ? "border-danger bg-danger-soft/60 hover:bg-danger-soft"
                      : "border-warning-solid bg-warning-soft/50 hover:bg-warning-soft/80"
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
                        {r.sku ? `SKU: ${r.sku} · ` : ""}{interpolate(s.thresholdText, { threshold: r.threshold })}
                      </span>
                      <Badge tone={r.thresholdSource === "product" ? "brand" : r.thresholdSource === "settings" ? "info" : "neutral"}>
                        {r.thresholdSource === "product" ? s.sourceProduct : r.thresholdSource === "settings" ? s.sourceSettings : s.sourceDefault}
                      </Badge>
                    </span>
                  </span>
                  <Badge tone={out ? "danger" : "warning"} dot>
                    {out ? ct.outOfStock : interpolate(s.availableBadge, { count: r.quantityAvailable })}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink ring-1 ring-brand-ink/10"
          >
            <Icon name="truck" size={20} />
          </span>
          <h2 className="font-display text-h3 font-semibold">{s.poSectionTitle}</h2>
        </div>
        <p className="mt-2 max-w-3xl text-small leading-relaxed text-text-muted">
          {s.poSectionBody}
        </p>
        <div className="mt-4">
          <PurchaseOrdersPanel />
        </div>
      </Card>

      {/* ADV-20 inventory depth — flag-gated (module.inventory_depth).
          ABC + dead stock + expiring batches + auto-reorder, all from
          src/inventory/analytics.ts + reorder.ts via the depth API. */}
      {isFeatureEnabled("module.inventory_depth") ? (
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink ring-1 ring-brand-ink/10"
            >
              <Icon name="chart" size={20} />
            </span>
            <h2 className="font-display text-h3 font-semibold">{s.depthSectionTitle}</h2>
            <Badge tone="brand">ADV-20</Badge>
          </div>
          <p className="mt-2 max-w-3xl text-small leading-relaxed text-text-muted">
            {s.depthSectionBody}
          </p>
          <div className="mt-4">
            <InventoryDepthPanel />
          </div>
        </Card>
      ) : null}

      <p className="mt-4 text-caption leading-relaxed text-text-subtle">
        {s.footerNote}
      </p>
    </main>
  );
}
