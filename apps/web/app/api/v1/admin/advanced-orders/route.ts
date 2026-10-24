import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { allocateOrderItems } from "@/advanced-orders/split";
import { demoAdvancedOrderStore } from "@/advanced-orders/store";

// Advanced orders — Agent 16, Step 48 (A9).
// GET: demo pre-orders + transfers. POST: split-allocation PREVIEW — pure
// computation over the supplied items/warehouse stock, persists nothing.
// Persistence is in-memory demo, labelled in meta, until Prisma lands.

const splitPreviewSchema = z.object({
  items: z.array(z.object({
    variantId: z.string().min(1),
    productName: z.string().min(1),
    sku: z.string().min(1),
    unitPricePoisha: z.number().int().nonnegative(),
    quantity: z.number().int().positive(),
  })).min(1),
  warehouses: z.array(z.object({
    warehouseId: z.string().min(1),
    warehouseName: z.string().min(1),
    priority: z.number().int().nonnegative(),
    availableByVariant: z.record(z.string(), z.number().int().nonnegative()),
  })).min(1),
});

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json({
    data: {
      preOrders: demoAdvancedOrderStore.listPreOrders(),
      transfers: demoAdvancedOrderStore.listTransfers(),
    },
    meta: { persistence: "in-memory-demo", source: "TEMPORARY_DEMO_STORE" },
  });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = splitPreviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid split preview input.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const allocation = allocateOrderItems(parsed.data.items, parsed.data.warehouses);
  return NextResponse.json({
    data: { allocation },
    meta: { persistence: "none-pure-computation", persisted: false },
  });
}
