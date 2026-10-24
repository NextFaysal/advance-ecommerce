import { NextResponse } from "next/server";
import { z } from "zod";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor refund chargebacks — VendorRefund rows. A recorded refund
// reduces the vendor's net payout (see the payout route /
// summarizePayout); the reason is mandatory, mirroring the codebase's
// sensitive-action convention. DB-backed (advanced_modules_completion
// migration, 2026-10-25).

const createRefundSchema = z.object({
  amountPoisha: z.number().int().positive(),
  orderId: z.string().min(1).optional(),
  reason: z.string().trim().min(3, "reason is required for a vendor refund chargeback"),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const refunds = await vendorApiStore.listRefunds(vendor.id);
  return NextResponse.json({
    data: { refunds, totalPoisha: await vendorApiStore.refundsPoisha(vendor.id) },
    meta: { persistence: "database" },
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createRefundSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid vendor refund.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const refund = await vendorApiStore.addRefund({
    vendorId: vendor.id,
    orderId: parsed.data.orderId ?? null,
    amountPoisha: parsed.data.amountPoisha,
    reason: parsed.data.reason,
  });
  return NextResponse.json(
    { data: { refund }, meta: { persistence: "database" } },
    { status: 201 },
  );
}
