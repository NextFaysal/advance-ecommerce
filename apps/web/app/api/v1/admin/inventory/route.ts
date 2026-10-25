import { NextResponse } from "next/server";
import { InMemoryInventoryStore, lowStockList, movementActionSchema, valuationPoisha } from "@/inventory/service";
import {
  LOW_STOCK_THRESHOLD,
  applyMovementDb,
  getVariantCostMapDb,
  getVariantStockCacheDb,
  listInventoryItemsDb,
} from "@/inventory/repository";
import { writeAudit } from "@/lib/audit";
import { guardError, requireAdmin } from "@/reports/guard";

// GET /api/v1/admin/inventory — list + low stock + valuation (DB, Prisma)
// POST — a stock movement via the ledger (never a direct quantity edit).
// RBAC: inventory.view (GET) / inventory.adjust (POST).
// Persistence: Prisma — InventoryItem rows + StockMovement ledger rows
// (src/inventory/repository.ts). The pure helpers (lowStockList,
// valuationPoisha) run over the DB rows via a throwaway in-memory
// adapter; valuation covers only variants that carry a costPoisha and
// reports how many items were excluded for a missing cost.

function isMovementRejection(e: unknown): boolean {
  return (
    e instanceof Error &&
    /insufficient|cannot commit|cannot release|must be positive|unknown movement/.test(e.message)
  );
}

function isForeignKeyError(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2003";
}

export async function GET() {
  const guard = await requireAdmin("inventory.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const items = await listInventoryItemsDb();
    const [costMap, stockCacheMap] = await Promise.all([
      getVariantCostMapDb(items.map((i) => i.variantId)),
      getVariantStockCacheDb(items.map((i) => i.variantId)),
    ]);
    const costedItems = items.filter((i) => costMap.has(i.variantId));
    // Pure reporting helpers over the DB snapshot (same pattern the
    // admin page used with the demo store — the store here is only an
    // adapter for the pure functions, never a persistence layer).
    const adapter = new InMemoryInventoryStore(items);
    return NextResponse.json({
      data: {
        items,
        // Canonical per-variant availability (doc 18, F1):
        // ProductVariant.stock — the number the order funnel claims
        // against. `items[].quantityAvailable` is the warehouse
        // ledger's view, which double-subtracts order reservations
        // (see getVariantStockCacheDb); headline THIS map per
        // variant, exactly as the admin page does.
        stockCacheByVariant: Object.fromEntries(stockCacheMap),
        lowStock: lowStockList(adapter, LOW_STOCK_THRESHOLD),
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        valuationPoisha: valuationPoisha(costedItems, Object.fromEntries(costMap)),
        valuationMissingCostItems: items.length - costedItems.length,
      },
      meta: { persistence: "database", source: "DATABASE" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Inventory needs a working database." } },
      { status: 503 },
    );
  }
}

export async function POST(req: Request) {
  const guard = await requireAdmin("inventory.adjust");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = movementActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid stock movement.", details: parsed.error.issues } }, { status: 400 });
  }
  try {
    const result = await applyMovementDb({ ...parsed.data, actorId: guard.userId });
    // The movement is a sensitive stock change: audit it with the actor,
    // the movement and the required reason (reason is mandatory in
    // movementActionSchema, so an adjustment can never be anonymous).
    await writeAudit({
      actorId: guard.userId,
      action: "inventory.adjust",
      entityType: "StockMovement",
      entityId: result.movement.id,
      afterJson: {
        variantId: result.movement.variantId,
        warehouseId: result.movement.warehouseId,
        type: result.movement.type,
        quantityDelta: result.movement.quantityDelta,
        quantityBefore: result.movement.quantityBefore,
        quantityAfter: result.movement.quantityAfter,
        referenceType: result.movement.referenceType,
        referenceId: result.movement.referenceId,
      },
      reason: parsed.data.reason,
    });
    return NextResponse.json({ data: result, meta: { persistence: "database", audited: true } }, { status: 201 });
  } catch (e) {
    if (isMovementRejection(e)) {
      return NextResponse.json({ error: { code: "MOVEMENT_REJECTED", message: e instanceof Error ? e.message : "Movement rejected." } }, { status: 422 });
    }
    if (isForeignKeyError(e)) {
      return NextResponse.json({ error: { code: "INVALID_REFERENCE", message: "Variant or warehouse not found." } }, { status: 422 });
    }
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Inventory needs a working database." } }, { status: 503 });
  }
}
