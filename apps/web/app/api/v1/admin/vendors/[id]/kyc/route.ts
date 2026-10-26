import { NextResponse } from "next/server";
import { z } from "zod";
import { maskPhone } from "@/checkout/validation";
import { writeAudit } from "@/lib/audit";
import { canStaffSetKyc, STAFF_KYC_TARGETS } from "@/vendors/kyc";
import { getVendorKyc, setVendorKyc } from "@/vendors/kyc-store";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor KYC decisions — ADV-13. KYC state lives in the Setting-doc
// store (src/vendors/kyc-store.ts — the Vendor model has no KYC
// columns; see src/vendors/kyc.ts). GET: current record. PATCH: a
// staff decision (DOCUMENTS_REQUESTED / VERIFIED / REJECTED) —
// validated against the workflow, note REQUIRED when asking for
// documents or rejecting (the vendor sees the note in their
// portal), and audited (action vendors.kyc.update).
const patchSchema = z.object({
  status: z.enum(STAFF_KYC_TARGETS),
  note: z.string().max(1000).nullable().optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const kyc = await getVendorKyc(vendor.id);
  return NextResponse.json({
    data: { vendor: { id: vendor.id, shopName: vendor.shopName, phone: maskPhone(vendor.phone) }, kyc },
    meta: { persistence: "database" },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid KYC decision.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
  if ((parsed.data.status === "REJECTED" || parsed.data.status === "DOCUMENTS_REQUESTED") && note === null) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "A note is required when requesting documents or rejecting — the vendor sees it." } },
      { status: 400 },
    );
  }
  const current = await getVendorKyc(vendor.id);
  if (!canStaffSetKyc(current.status, parsed.data.status)) {
    return NextResponse.json(
      { error: { code: "INVALID_TRANSITION", message: `KYC cannot move ${current.status} -> ${parsed.data.status}.` } },
      { status: 422 },
    );
  }
  const record = await setVendorKyc(
    {
      ...current,
      status: parsed.data.status,
      note: note ?? current.note,
      updatedById: guard.userId,
      updatedAt: new Date().toISOString(),
    },
    guard.userId,
  );
  await writeAudit({
    actorId: guard.userId,
    action: "vendors.kyc.update",
    entityType: "Vendor",
    entityId: vendor.id,
    beforeJson: { kycStatus: current.status, kycNote: current.note },
    afterJson: { kycStatus: record.status, kycNote: record.note },
    reason: record.note ?? "KYC status update by staff",
  });
  return NextResponse.json({
    data: { vendor: { id: vendor.id, shopName: vendor.shopName, phone: maskPhone(vendor.phone) }, kyc: record },
    meta: { persistence: "database" },
  });
}
