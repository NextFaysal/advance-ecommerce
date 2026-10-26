/**
 * Vendor KYC documents — metadata store (schema wave 2).
 *
 * VendorDocument rows record documents the store has RECEIVED —
 * in person, by email, however they arrived — with the staff member
 * recording what it is (kind + file name) and later verifying or
 * rejecting it. No file bytes are stored here and there is still no
 * vendor self-upload: the portal shows the recorded documents and
 * keeps its upload control disabled until storage (R2/S3) exists
 * AND an upload endpoint is built (see portal.ts
 * getVendorDocumentStatus). A document's storageKey stays null until
 * a real uploaded object exists — never invented.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";

export const VENDOR_DOCUMENT_KINDS = ["TRADE_LICENSE", "NID", "TIN", "OTHER"] as const;
export type VendorDocumentKind = (typeof VENDOR_DOCUMENT_KINDS)[number];

export const VENDOR_DOCUMENT_STATUSES = ["PENDING", "VERIFIED", "REJECTED"] as const;
export type VendorDocumentStatusValue = (typeof VENDOR_DOCUMENT_STATUSES)[number];

export const VENDOR_DOCUMENT_KIND_BN: Record<VendorDocumentKind, string> = {
  TRADE_LICENSE: "ট্রেড লাইসেন্স",
  NID: "জাতীয় পরিচয়পত্র (NID)",
  TIN: "টিআইএন (TIN)",
  OTHER: "অন্যান্য",
};

export const VENDOR_DOCUMENT_STATUS_BN: Record<VendorDocumentStatusValue, string> = {
  PENDING: "যাচাইয়ের অপেক্ষায়",
  VERIFIED: "যাচাই সম্পন্ন",
  REJECTED: "প্রত্যাখ্যাত",
};

export interface VendorDocumentView {
  id: string;
  vendorId: string;
  kind: VendorDocumentKind;
  fileName: string;
  storageKey: string | null;
  status: VendorDocumentStatusValue;
  note: string | null;
  createdAt: string;
}

type VendorDocumentRow = NonNullable<Awaited<ReturnType<typeof prisma.vendorDocument.findUnique>>>;

export function rowToVendorDocument(row: VendorDocumentRow): VendorDocumentView {
  return {
    id: row.id,
    vendorId: row.vendorId,
    kind: row.kind as VendorDocumentKind,
    fileName: row.fileName,
    storageKey: row.storageKey,
    status: row.status as VendorDocumentStatusValue,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listVendorDocuments(vendorId: string): Promise<VendorDocumentView[]> {
  const rows = await prisma.vendorDocument.findMany({
    where: { vendorId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(rowToVendorDocument);
}

export const recordVendorDocumentSchema = z.object({
  kind: z.enum(VENDOR_DOCUMENT_KINDS),
  fileName: z.string().trim().min(1, "ফাইলের নাম দিন").max(200),
  note: z.string().trim().max(500).optional().nullable(),
});

export type RecordVendorDocumentInput = z.infer<typeof recordVendorDocumentSchema>;

/**
 * Record a received document (staff-side). storageKey is always
 * null here — no upload exists yet; the column is filled only by a
 * future real upload path.
 */
export async function recordVendorDocument(
  vendorId: string,
  input: RecordVendorDocumentInput,
): Promise<VendorDocumentView> {
  const row = await prisma.vendorDocument.create({
    data: {
      vendorId,
      kind: input.kind,
      fileName: input.fileName,
      storageKey: null,
      status: "PENDING",
      note: input.note ?? null,
    },
  });
  return rowToVendorDocument(row);
}

export const vendorDocumentDecisionSchema = z.object({
  status: z.enum(VENDOR_DOCUMENT_STATUSES),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Verify / reject / re-open a recorded document. */
export async function decideVendorDocument(
  documentId: string,
  input: { status: VendorDocumentStatusValue; note?: string | null },
): Promise<VendorDocumentView | null> {
  const existing = await prisma.vendorDocument.findUnique({ where: { id: documentId } });
  if (existing === null) return null;
  const row = await prisma.vendorDocument.update({
    where: { id: documentId },
    data: {
      status: input.status,
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
  return rowToVendorDocument(row);
}
