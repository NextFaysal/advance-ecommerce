/**
 * Cost-price masking (ADV-27, doc 22) — API serialisation helpers.
 *
 * THE RULE: cost prices (what the shop PAID) are visible only to
 * staff holding the `products.edit_cost_price` permission — the
 * catalogue's designated cost permission since the RBAC foundation
 * (src/lib/rbac.ts: costPriceForViewer). The Owner role holds every
 * permission (permissionsForRole("Owner") = PERMISSIONS), so the
 * owner is never masked. Everyone else — including roles that can
 * view products/inventory — receives cost fields as null, and the
 * response meta carries `costMasked: true` so the UI can render "—"
 * and say why, instead of the field silently disappearing
 * (the older stripCostPrice behaviour removed the key entirely;
 * these seams replace it with an explicit null + flag).
 *
 * Masking happens HERE, at the API serialisation seam, from data
 * already fetched — a masked value never reaches the browser in any
 * form. Derived aggregates that would leak cost (a purchase order's
 * total = Σ qty × cost; dead-stock value = stock × cost) are nulled
 * alongside the unit costs.
 *
 * Applied at: admin products list + detail, inventory depth report,
 * purchase-order list + receive detail. The product PATCH route also
 * uses canSeeCostPrices: a caller without the permission gets the
 * EXISTING cost written back over whatever their (masked-read-based)
 * payload carried, so a masked read can never wipe recorded costs
 * through the replace-semantics update.
 */
import { hasPermission } from "./rbac";

export const COST_PRICE_PERMISSION = "products.edit_cost_price" as const;

export function canSeeCostPrices(userPermissions: readonly string[]): boolean {
  return hasPermission(userPermissions, COST_PRICE_PERMISSION);
}

/** Catalog product (list/detail shape): null out variant costs. */
export function maskCatalogProduct<T extends { variants?: readonly { costPoisha?: number | null }[] }>(
  product: T,
  userPermissions: readonly string[],
): T {
  if (canSeeCostPrices(userPermissions)) return product;
  if (!product.variants) return product;
  return {
    ...product,
    variants: product.variants.map((v) => ({ ...v, costPoisha: null })),
  };
}

/** Inventory depth report (src/inventory/analytics.ts shape): the
 *  only cost-bearing rows are dead-stock rows (unit cost + the
 *  derived stock value). Batch rows carry no cost by design. */
export function maskInventoryDepthReport<
  T extends {
    deadStock: { rows: { costPoisha: number | null; stockValuePoisha: number | null }[] };
  },
>(report: T, userPermissions: readonly string[]): T {
  if (canSeeCostPrices(userPermissions)) return report;
  return {
    ...report,
    deadStock: {
      ...report.deadStock,
      rows: report.deadStock.rows.map((r) => ({ ...r, costPoisha: null, stockValuePoisha: null })),
    },
  };
}

/** Purchase order (list shape from src/inventory/repository.ts and
 *  the receive-detail shape from purchase-receive.ts share the field
 *  names): null unit costs, per-line received values, the PO total
 *  and the received value — every one is a cost or is derived from
 *  costs, so all of them mask together. Batch costs on the detail
 *  shape mask too. */
export function maskPurchaseOrder<
  T extends {
    totalPoisha?: number | null;
    receivedValuePoisha?: number | null;
    items?: readonly { costPoisha?: number | null; receivedValuePoisha?: number | null }[];
    lines?: readonly { costPoisha?: number | null; receivedValuePoisha?: number | null }[];
    batches?: readonly { costPoisha?: number | null }[];
  },
>(po: T, userPermissions: readonly string[]): T {
  if (canSeeCostPrices(userPermissions)) return po;
  const masked: T = { ...po };
  if ("totalPoisha" in masked) masked.totalPoisha = null;
  if ("receivedValuePoisha" in masked) masked.receivedValuePoisha = null;
  const nullCosts = <I extends { costPoisha?: number | null; receivedValuePoisha?: number | null }>(row: I): I => {
    const out: I = { ...row };
    if ("costPoisha" in out) out.costPoisha = null;
    if ("receivedValuePoisha" in out) out.receivedValuePoisha = null;
    return out;
  };
  if (masked.items) masked.items = masked.items.map(nullCosts);
  if (masked.lines) masked.lines = masked.lines.map(nullCosts);
  if (masked.batches) {
    masked.batches = masked.batches.map((b) => ("costPoisha" in b ? { ...b, costPoisha: null } : b));
  }
  return masked;
}
