/**
 * Vendor KYC — ADV-13 (doc 22). Pure types + state machine.
 *
 * SCHEMA REALITY (audit, 2026-10-26): the Vendor model has NO KYC
 * fields at all — no kycStatus, no document columns, no staff-note
 * field. This slice owns no migration, so KYC state lives in a
 * Setting-table JSON document (src/vendors/kyc-store.ts — the same
 * no-migration pattern as the report builder's saved definitions),
 * one record per vendor. A future schema wave can promote this to
 * Vendor columns (kycStatus / kycNote / kycUpdatedAt) without
 * changing the workflow defined here.
 *
 * DOCUMENT GAP, precisely: there is nowhere to persist a document
 * URL — Vendor has no tradeLicense / NID / document fields, and no
 * VendorDocument model exists. The status workflow below therefore
 * runs WITHOUT uploads: staff verify documents through whatever
 * channel the business already uses (in person / messenger) and
 * record the outcome + note here. The portal's upload control stays
 * disabled with the honest reason until (a) storage credentials
 * exist in Settings AND (b) a schema wave adds somewhere for the
 * URLs to live.
 *
 * Workflow: NOT_SUBMITTED —(vendor submits)→ PENDING —(staff)→
 * DOCUMENTS_REQUESTED / VERIFIED / REJECTED. From DOCUMENTS_REQUESTED
 * the vendor resubmits → PENDING. Staff may move a VERIFIED vendor
 * back to DOCUMENTS_REQUESTED / REJECTED (re-verification / fraud).
 * Every staff decision carries a note the vendor sees in the portal.
 */
import { z } from "zod";
import { pick, type Locale } from "../i18n/locale";

export const VENDOR_KYC_STATUSES = [
  "NOT_SUBMITTED",
  "PENDING",
  "DOCUMENTS_REQUESTED",
  "VERIFIED",
  "REJECTED",
] as const;

export type VendorKycStatus = (typeof VENDOR_KYC_STATUSES)[number];

export interface VendorKycRecord {
  vendorId: string;
  status: VendorKycStatus;
  /** Latest staff note (the vendor sees this). Null when staff have
   *  never written one. Never an invented message. */
  note: string | null;
  /** Staff user id of the last staff decision; null for vendor-only
   *  transitions (submission). */
  updatedById: string | null;
  /** ISO timestamp of the last state change. */
  updatedAt: string;
  /** ISO timestamp of the vendor's latest submission, or null. */
  submittedAt: string | null;
}

export function defaultVendorKyc(vendorId: string): VendorKycRecord {
  return {
    vendorId,
    status: "NOT_SUBMITTED",
    note: null,
    updatedById: null,
    updatedAt: new Date(0).toISOString(),
    submittedAt: null,
  };
}

/**
 * Doc 30: status labels are display copy — a bn/en pair per status
 * (the en set mirrors the admin vendors dictionary exactly). The
 * status KEYS never localize. VENDOR_KYC_STATUS_BN stays as the bn
 * half for existing imports.
 */
export const VENDOR_KYC_STATUS_LABELS: Record<Locale, Record<VendorKycStatus, string>> = {
  bn: {
    NOT_SUBMITTED: "জমা দেওয়া হয়নি",
    PENDING: "যাচাইয়ের অপেক্ষায়",
    DOCUMENTS_REQUESTED: "আরও কাগজপত্র চাওয়া হয়েছে",
    VERIFIED: "যাচাই সম্পন্ন ✓",
    REJECTED: "প্রত্যাখ্যাত",
  },
  en: {
    NOT_SUBMITTED: "Not submitted",
    PENDING: "Awaiting verification",
    DOCUMENTS_REQUESTED: "More documents requested",
    VERIFIED: "Verified ✓",
    REJECTED: "Rejected",
  },
};

export const VENDOR_KYC_STATUS_BN: Record<VendorKycStatus, string> = VENDOR_KYC_STATUS_LABELS.bn;

export function vendorKycStatusLabel(status: VendorKycStatus, locale: Locale): string {
  return pick(locale, VENDOR_KYC_STATUS_LABELS)[status];
}

/** States a staff decision may set (staff never sets PENDING —
 *  that is the vendor's submission state — nor NOT_SUBMITTED). */
export const STAFF_KYC_TARGETS = ["DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"] as const;
export type StaffKycTarget = (typeof STAFF_KYC_TARGETS)[number];

const STAFF_TRANSITIONS: Record<VendorKycStatus, readonly StaffKycTarget[]> = {
  NOT_SUBMITTED: ["DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"],
  PENDING: ["DOCUMENTS_REQUESTED", "VERIFIED", "REJECTED"],
  DOCUMENTS_REQUESTED: ["VERIFIED", "REJECTED"],
  VERIFIED: ["DOCUMENTS_REQUESTED", "REJECTED"],
  REJECTED: ["DOCUMENTS_REQUESTED", "VERIFIED"],
};

export function canStaffSetKyc(from: VendorKycStatus, to: StaffKycTarget): boolean {
  return STAFF_TRANSITIONS[from].includes(to);
}

/** The vendor may (re)submit from these states. */
export function canVendorSubmitKyc(from: VendorKycStatus): boolean {
  return from === "NOT_SUBMITTED" || from === "DOCUMENTS_REQUESTED" || from === "REJECTED";
}

/* Stored-document schema (the Setting row's JSON value). */
export const vendorKycRecordSchema = z.object({
  vendorId: z.string().min(1),
  status: z.enum(VENDOR_KYC_STATUSES),
  note: z.string().nullable(),
  updatedById: z.string().nullable(),
  updatedAt: z.string(),
  submittedAt: z.string().nullable(),
});

export const vendorKycDocSchema = z.record(z.string(), vendorKycRecordSchema);

export type VendorKycDoc = z.infer<typeof vendorKycDocSchema>;
