import { NextResponse } from "next/server";
import { summarizePayout } from "@/vendors/service";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor payout summary — Agent 18. Uses Agent 16's summarizePayout():
// commission in basis points floored to whole poisha, refunds reduce the
// payout, net payable never below zero. The vendor record is DB-backed;
// commission lines have NO schema table (orders carry no vendor link),
// so lines/refunds remain in-memory and the summary is computed over
// whatever lines the process holds — meta labels this honestly.

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
    meta: { persistence: "mixed", source: "vendor:database, commission-lines:in-memory-no-schema-table" },
  });
}
