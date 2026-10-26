/**
 * Auto-reorder (ADV-20, doc 22): variants at/below their reorder point
 * get DRAFT purchase orders. The engine NEVER sends or places an
 * order — it only creates drafts through the existing PO create path
 * (createPurchaseOrderDb) for staff to review, exactly like a staff
 * member typing the PO in by hand.
 *
 * RULES (Settings inventory.reorder.*):
 *  - Point: per-variant override (inventory.reorder.overrides JSON
 *    map variantId → { point, qty, supplierId }) wins; else
 *    inventory.reorder.default_point. No point anywhere = the variant
 *    is not a candidate (a missing rule is not a zero rule).
 *  - Qty: override qty, else inventory.reorder.default_qty. Missing
 *    or non-positive = skipped (invalid_rule).
 *  - Supplier: override supplierId → the supplier on the variant's
 *    most recent purchase order → inventory.reorder
 *    .default_supplier_id. None = skipped (no_supplier). Product and
 *    ProductVariant carry NO supplier link (audited ADV-20), so
 *    purchase history + Settings are the only honest sources.
 *  - Cost: variant.costPoisha → most recent PO line cost. None =
 *    skipped (no_cost) — a draft with an invented price would poison
 *    the purchase ledger.
 *  - Dedupe: a variant already covered by an OPEN purchase order
 *    (DRAFT / ORDERED / PARTIALLY_RECEIVED with units still
 *    outstanding) is skipped (open_po_exists) — re-runs are safe.
 *
 * runAutoReorder is worker-tick-ready: pure function of DB + Settings,
 * no request context; the admin "এখন চালান" route is a thin trigger.
 */
import { prisma } from "@advance-ecommerce/db";
import { getSetting } from "../lib/settings";
import { createPurchaseOrderDb } from "./repository";

export interface ReorderOverride {
  point?: number;
  qty?: number;
  supplierId?: string;
}

export interface ReorderSkip {
  variantId: string;
  sku: string;
  reason:
    | "open_po_exists"
    | "no_supplier"
    | "supplier_not_found"
    | "no_cost"
    | "invalid_rule"
    | "no_warehouse"
    | "create_failed";
  detail?: string;
}

export interface ReorderCreatedPo {
  purchaseOrderId: string;
  supplierId: string;
  supplierName: string;
  lines: { variantId: string; sku: string; quantity: number; costPoisha: number }[];
}

export interface AutoReorderResult {
  createdPos: ReorderCreatedPo[];
  skipped: ReorderSkip[];
  consideredCount: number;
}

function parsePositiveInt(raw: string | null | undefined): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseNonNegativeInt(raw: string | null | undefined): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parseOverrides(raw: string | null | undefined): Map<string, ReorderOverride> {
  const map = new Map<string, ReorderOverride>();
  if (!raw) return map;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    for (const [variantId, value] of Object.entries(parsed)) {
      if (value && typeof value === "object") {
        const v = value as Record<string, unknown>;
        map.set(variantId, {
          point: typeof v["point"] === "number" ? v["point"] : undefined,
          qty: typeof v["qty"] === "number" ? v["qty"] : undefined,
          supplierId: typeof v["supplierId"] === "string" ? v["supplierId"] : undefined,
        });
      }
    }
  } catch {
    // A malformed overrides document disables overrides only — the
    // global defaults still apply. (Settings writes validate JSON
    // server-side; this is defence in depth.)
  }
  return map;
}

const OPEN_PO_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED"] as const;

export async function runAutoReorder(actorId: string): Promise<AutoReorderResult> {
  const [defaultPointRaw, defaultQtyRaw, defaultSupplierRaw, overridesRaw] = await Promise.all([
    getSetting("inventory.reorder.default_point").catch(() => ""),
    getSetting("inventory.reorder.default_qty").catch(() => ""),
    getSetting("inventory.reorder.default_supplier_id").catch(() => ""),
    getSetting("inventory.reorder.overrides").catch(() => "{}"),
  ]);
  const defaultPoint = parseNonNegativeInt(defaultPointRaw);
  const defaultQty = parsePositiveInt(defaultQtyRaw);
  const defaultSupplierId = (defaultSupplierRaw ?? "").trim() || null;
  const overrides = parseOverrides(overridesRaw);

  const result: AutoReorderResult = { createdPos: [], skipped: [], consideredCount: 0 };

  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, sku: true, stock: true, costPoisha: true },
    orderBy: { sku: "asc" },
  });

  const warehouse = await prisma.warehouse.findFirst({
    where: { isActive: true, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  interface PlannedLine {
    variantId: string;
    sku: string;
    quantity: number;
    costPoisha: number;
    supplierId: string;
  }
  const planned: PlannedLine[] = [];

  for (const variant of variants) {
    const override = overrides.get(variant.id);
    const point = override?.point ?? defaultPoint;
    if (point === null || point === undefined) continue; // no rule → not a candidate
    if (variant.stock > point) continue;
    result.consideredCount += 1;

    const qty = override?.qty ?? defaultQty;
    if (qty === null || qty === undefined || qty <= 0) {
      result.skipped.push({ variantId: variant.id, sku: variant.sku, reason: "invalid_rule", detail: "No reorder quantity configured." });
      continue;
    }

    // Dedupe: an open PO already covering this variant with units
    // still outstanding means a reorder is already in flight.
    const openLine = await prisma.purchaseOrderItem.findFirst({
      where: {
        variantId: variant.id,
        purchaseOrder: { status: { in: [...OPEN_PO_STATUSES] }, deletedAt: null },
      },
      select: { quantityOrdered: true, quantityReceived: true, purchaseOrderId: true },
    });
    if (openLine && openLine.quantityOrdered - openLine.quantityReceived > 0) {
      result.skipped.push({
        variantId: variant.id,
        sku: variant.sku,
        reason: "open_po_exists",
        detail: `Open PO ${openLine.purchaseOrderId} still has ${openLine.quantityOrdered - openLine.quantityReceived} units outstanding.`,
      });
      continue;
    }

    // Purchase history: supplier + cost fallback from the most recent
    // PO line for this variant.
    const lastPurchase = await prisma.purchaseOrderItem.findFirst({
      where: { variantId: variant.id, purchaseOrder: { deletedAt: null } },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
      select: { costPoisha: true, purchaseOrder: { select: { supplierId: true } } },
    });

    const supplierId =
      override?.supplierId ?? lastPurchase?.purchaseOrder.supplierId ?? defaultSupplierId;
    if (!supplierId) {
      result.skipped.push({ variantId: variant.id, sku: variant.sku, reason: "no_supplier", detail: "No override, purchase-history or default supplier." });
      continue;
    }
    const costPoisha = variant.costPoisha ?? lastPurchase?.costPoisha ?? null;
    if (costPoisha === null) {
      result.skipped.push({ variantId: variant.id, sku: variant.sku, reason: "no_cost", detail: "No variant cost and no purchase history cost." });
      continue;
    }
    planned.push({ variantId: variant.id, sku: variant.sku, quantity: qty, costPoisha, supplierId });
  }

  if (planned.length > 0 && !warehouse) {
    for (const line of planned) {
      result.skipped.push({ variantId: line.variantId, sku: line.sku, reason: "no_warehouse" });
    }
    return result;
  }

  // Group by supplier → ONE DRAFT PO per supplier.
  const bySupplier = new Map<string, PlannedLine[]>();
  for (const line of planned) {
    const group = bySupplier.get(line.supplierId) ?? [];
    group.push(line);
    bySupplier.set(line.supplierId, group);
  }
  for (const [supplierId, lines] of bySupplier) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplierId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!supplier) {
      for (const line of lines) {
        result.skipped.push({ variantId: line.variantId, sku: line.sku, reason: "supplier_not_found", detail: supplierId });
      }
      continue;
    }
    try {
      const created = await createPurchaseOrderDb({
        supplierId: supplier.id,
        supplierName: supplier.name,
        warehouseId: warehouse!.id,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, costPoisha: l.costPoisha })),
        note: `Auto-reorder DRAFT (ADV-20) by ${actorId} — staff review required before ordering; never auto-sent.`,
      });
      result.createdPos.push({
        purchaseOrderId: created.id,
        supplierId: supplier.id,
        supplierName: supplier.name,
        lines: lines.map((l) => ({ variantId: l.variantId, sku: l.sku, quantity: l.quantity, costPoisha: l.costPoisha })),
      });
    } catch (err) {
      for (const line of lines) {
        result.skipped.push({
          variantId: line.variantId,
          sku: line.sku,
          reason: "create_failed",
          detail: err instanceof Error ? err.message : "unknown error",
        });
      }
    }
  }
  return result;
}
