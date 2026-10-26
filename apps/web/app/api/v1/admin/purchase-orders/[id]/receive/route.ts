import { NextResponse } from "next/server";
import { z } from "zod";
import {
  PurchaseReceiveError,
  receivePurchaseOrder,
} from "@/inventory/purchase-receive";
import { writeAudit } from "@/lib/audit";
import { guardError, requireAdmin } from "@/reports/guard";

// Receive goods against a purchase order — ADV-11b (doc 22).
// POST body: { lines: [{ itemId, quantity }], idempotencyKey?,
//              reason? }
// One transaction (src/inventory/purchase-receive.ts): per-line
// quantityReceived increments + PURCHASE_RECEIVE ledger movements
// with the PO reference; over-receipt rejects the WHOLE request.
// RBAC: inventory.purchase_order. Every successful receive is
// audit-logged (an idempotent replay is logged as such).

const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().int().positive(),
        // ADV-20 depth capture (optional; the service rejects the
        // whole receive when module.inventory_depth is OFF).
        batchCode: z.string().trim().max(80).optional(),
        expiryDate: z.string().trim().max(40).optional(),
        bin: z.string().trim().max(40).optional(),
        serials: z.array(z.string().trim().min(1).max(120)).max(1000).optional(),
      }),
    )
    .min(1),
  idempotencyKey: z.string().min(1).max(120).optional(),
  reason: z.string().min(1).max(300).optional(),
});

const ERROR_STATUS: Record<string, number> = {
  purchase_order_not_found: 404,
  purchase_order_cancelled: 422,
  no_warehouse_available: 422,
  empty_receive: 400,
  duplicate_line: 400,
  item_not_on_order: 422,
  invalid_quantity: 400,
  over_receive: 422,
  serial_count_mismatch: 400,
  duplicate_serial: 409,
  invalid_expiry_date: 400,
  expiry_without_batch: 400,
  inventory_depth_disabled: 422,
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("inventory.purchase_order");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = receiveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid receive request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  try {
    const result = await receivePurchaseOrder({
      purchaseOrderId: params.id,
      lines: parsed.data.lines,
      actorId: guard.userId,
      idempotencyKey: parsed.data.idempotencyKey,
      reason: parsed.data.reason,
    });
    await writeAudit({
      actorId: guard.userId,
      action: result.idempotentReplay
        ? "inventory.purchase_order.receive_replay"
        : "inventory.purchase_order.receive",
      entityType: "PurchaseOrder",
      entityId: params.id,
      afterJson: {
        status: result.status,
        warehouseId: result.warehouseId,
        receivedValueDeltaPoisha: result.receivedValueDeltaPoisha,
        lines: result.lines.map((l) => ({
          itemId: l.itemId,
          quantityReceivedNow: l.quantityReceivedNow,
          quantityReceivedTotal: l.quantityReceivedTotal,
        })),
        erpPosting: result.erpPosting?.status ?? null,
      },
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    }).catch(() => null);
    return NextResponse.json({
      data: { receive: result },
      meta: {
        persistence: "database",
        note: result.idempotentReplay
          ? "Idempotent replay — this receive was already booked; nothing was written."
          : "Stock booked via PURCHASE_RECEIVE ledger movements referencing this purchase order.",
      },
    });
  } catch (e) {
    if (e instanceof PurchaseReceiveError) {
      return NextResponse.json(
        { error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
        { status: ERROR_STATUS[e.code] ?? 422 },
      );
    }
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Purchase orders need a working database." } },
      { status: 503 },
    );
  }
}
