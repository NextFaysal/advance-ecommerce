import { NextResponse } from "next/server";
import { InMemoryInventoryStore, applyMovement, lowStockList, movementActionSchema, valuationPoisha } from "@/inventory/service";
import { DEMO_COST_POISHA, DEMO_INVENTORY, DEMO_LOW_STOCK_THRESHOLD } from "@/reports/demo";
import { guardError, requireAdmin } from "@/reports/guard";

// GET /api/v1/admin/inventory — list + low stock + valuation (DEMO in-memory)
// POST — a stock movement via the ledger (never a direct quantity edit).
// RBAC: inventory.view (GET) / inventory.adjust (POST).
// Persistence is in-memory demo until the Prisma store lands; meta says so.
const store = new InMemoryInventoryStore(DEMO_INVENTORY);

export async function GET() {
  const guard = await requireAdmin("inventory.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const items = store.listItems();
  return NextResponse.json({
    data: {
      items,
      lowStock: lowStockList(store, DEMO_LOW_STOCK_THRESHOLD),
      lowStockThreshold: DEMO_LOW_STOCK_THRESHOLD,
      valuationPoisha: valuationPoisha(items, DEMO_COST_POISHA),
    },
    meta: { persistence: "in-memory-demo", source: "TEMPORARY_DEMO" },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("inventory.adjust");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = movementActionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid stock movement.", details: parsed.error.issues } }, { status: 400 });
  }
  // Audit note: a Prisma implementation must writeAudit() here with actor,
  // action, entity and reason before applying the movement (audit.ts).
  // Reason is required by movementActionSchema, so a sensitive adjustment
  // can never be applied anonymously in this contract.
  try {
    const result = applyMovement(store, { ...parsed.data, actorId: guard.userId });
    return NextResponse.json({ data: result, meta: { persistence: "in-memory-demo", audited: false, auditPending: "prisma" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: { code: "MOVEMENT_REJECTED", message: e instanceof Error ? e.message : "Movement rejected." } }, { status: 422 });
  }
}
