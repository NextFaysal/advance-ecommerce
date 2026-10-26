import { NextResponse } from "next/server";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { maskPhone } from "@/checkout/validation";
import {
  decideVendorDocument,
  listVendorDocuments,
  recordVendorDocument,
  recordVendorDocumentSchema,
  vendorDocumentDecisionSchema,
} from "@/vendors/documents";
import { requireVendorAdmin, vendorGuardError } from "../../guard";
import { vendorApiStore } from "../../store";

// Vendor KYC documents — admin side (schema wave 2). METADATA ONLY:
// staff record documents the store received out-of-band (kind + file
// name) and verify / reject them; the vendor sees the records in
// their portal. No file is uploaded through this route — there is no
// storage object behind a record until a real upload path exists,
// and storageKey is never invented here.
// GET:  list the vendor's documents (vendors.view).
// POST: record a received document (vendors.manage, audited).
// PATCH: decide one document { documentId, status, note? }
//        (vendors.manage, audited).
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.view");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const documents = await listVendorDocuments(params.id);
  return NextResponse.json({ data: { documents }, meta: { persistence: "database" } });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const vendor = await vendorApiStore.getVendor(params.id);
  if (!vendor) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Vendor not found." } }, { status: 404 });
  }
  const parsed = recordVendorDocumentSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "kind + fileName required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const document = await recordVendorDocument(params.id, parsed.data);
  await writeAudit({
    actorId: guard.userId,
    action: "vendors.document.record",
    entityType: "VendorDocument",
    entityId: document.id,
    afterJson: { vendorId: params.id, kind: document.kind, fileName: document.fileName, status: document.status },
    reason: `Document recorded for ${vendor.shopName} (${maskPhone(vendor.phone)}) — received out-of-band; no upload.`,
  });
  return NextResponse.json({ data: { document }, meta: { persistence: "database" } }, { status: 201 });
}

const patchSchema = vendorDocumentDecisionSchema.extend({
  documentId: z.string().min(1),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireVendorAdmin("vendors.manage");
  if (!guard.ok) return NextResponse.json(vendorGuardError(guard), { status: guard.status });
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "documentId + valid status required.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const document = await decideVendorDocument(parsed.data.documentId, {
    status: parsed.data.status,
    note: parsed.data.note ?? undefined,
  });
  if (document === null || document.vendorId !== params.id) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found for this vendor." } }, { status: 404 });
  }
  await writeAudit({
    actorId: guard.userId,
    action: "vendors.document.decide",
    entityType: "VendorDocument",
    entityId: document.id,
    afterJson: { vendorId: params.id, kind: document.kind, status: document.status, note: document.note },
    reason: `Document ${document.status.toLowerCase()} by staff.`,
  });
  return NextResponse.json({ data: { document }, meta: { persistence: "database" } });
}
