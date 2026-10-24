import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { preOrderSchema, type PreOrder } from "@/advanced-orders/types";
import { preOrderDuePoisha, validatePreOrderDeposit } from "@/advanced-orders/exchange-merge";
import { advancedOrderStore } from "@/advanced-orders/db-store";

// Pre-orders — Agent 16, Step 48 (A9). DB-backed (Prisma) since 2026-10-24.

export async function GET() {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const preOrders = (await advancedOrderStore.listPreOrders()).map((p) => ({
    ...p,
    totalPoisha: p.unitPricePoisha * p.quantity,
    duePoisha: preOrderDuePoisha(p),
  }));
  return NextResponse.json({ data: { preOrders }, meta: { persistence: "database" } });
}

export async function POST(req: Request) {
  const guard = await requireAdmin("orders.create");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = preOrderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid pre-order.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const totalPoisha = parsed.data.unitPricePoisha * parsed.data.quantity;
  const depositError = validatePreOrderDeposit(totalPoisha, parsed.data.depositPoisha);
  if (depositError) {
    return NextResponse.json(
      { error: { code: "INVALID_DEPOSIT", message: depositError } },
      { status: 422 },
    );
  }
  const preOrder: PreOrder = {
    ...parsed.data,
    id: `pre_${Date.now()}`,
    status: "OPEN",
    fulfilledQty: 0,
    createdAt: new Date().toISOString(),
  };
  const saved = await advancedOrderStore.addPreOrder(preOrder);
  return NextResponse.json(
    { data: { preOrder: saved, totalPoisha, duePoisha: preOrderDuePoisha(saved) }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
