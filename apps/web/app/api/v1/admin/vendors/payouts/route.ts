import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import {
  decideVendorPayoutRequestDb,
  listVendorPayoutRequestsAdmin,
} from "@/vendors/payout-store";
import { requireVendorAdmin, vendorGuardError } from "../guard";

// Vendor payout requests — admin side (schema wave 2), mirroring the
// reseller admin payouts route (ADV-12).
// GET:  list every request (vendors.view), with the owning vendor's
//       shop name + MASKED phone.
// POST: decide one request (vendors.manage) — APPROVED / PAID /
//       REJECTED through the pure state machine in
//       src/vendors/payouts.ts. PAID means "staff recorded an
//       external payment" — this route never moves money itself.
//       Every decision is audit-logged (writeAudit) and the note is
//       stored on the request where the vendor can see it.
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const requests = await listVendorPayoutRequestsAdmin();
  return NextResponse.json({
    data: { requests },
    meta: {
      persistence: "database",
      module: "module.multi_vendor",
      note: "PAID = staff recorded an external payment; no money moves automatically.",
    },
  });
}

const decideSchema = z.object({
  payoutId: z.string().min(1),
  action: z.enum(["APPROVED", "PAID", "REJECTED"]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const parsed = decideSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "payoutId + valid action required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = await decideVendorPayoutRequestDb(parsed.data.payoutId, {
    action: parsed.data.action,
    decidedById: guard.userId,
    note: parsed.data.note ?? null,
  });
  if (!result.ok) {
    if (result.notFound) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Payout request not found." } }, { status: 404 });
    }
    return NextResponse.json({ error: { code: "DECISION_REJECTED", message: result.error } }, { status: 422 });
  }
  await writeAudit({
    actorId: guard.userId,
    action: "vendors.payout.decide",
    entityType: "VendorPayoutRequest",
    entityId: result.request.id,
    afterJson: {
      vendorId: result.request.vendorId,
      amountPoisha: result.request.amountPoisha,
      method: result.request.method,
      status: result.request.status,
    },
    reason:
      parsed.data.note ??
      (result.request.status === "PAID"
        ? "Marked PAID — staff recorded an external payment to the vendor."
        : `Payout request ${result.request.status.toLowerCase()} from the admin panel.`),
  });
  return NextResponse.json({ data: { request: result.request }, meta: { persistence: "database" } });
}
