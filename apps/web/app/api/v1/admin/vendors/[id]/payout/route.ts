import { NextResponse } from "next/server";
import { summarizePayout } from "@/vendors/service";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor payout summary — Agent 18. Uses Agent 16's summarizePayout():
// commission in basis points floored to whole poisha, refunds reduce the
// payout, net payable never below zero. Vendor record, commission lines
// (VendorCommissionLine, written by the delivered-order hook) and refund
// chargebacks (VendorRefund) are all DB-backed since the
// advanced_modules_completion migration (2026-10-25).

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const lines = await vendorApiStore.listCommissionLines(vendor.id);
  const summary = summarizePayout(vendor.id, lines, await vendorApiStore.refundsPoisha(vendor.id));
  return NextResponse.json({
    data: { summary, lines },
    meta: { persistence: "database" },
  });
}
