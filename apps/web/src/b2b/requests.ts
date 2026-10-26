/**
 * Buyer-submitted B2B quotation requests (RFQs) + bulk CSV orders —
 * ADV-14 remainder (doc 22).
 *
 * Server-only (imports the Prisma client).
 *
 * WHAT AN RFQ IS HERE: a Quotation row with status DRAFT — the status
 * the codebase already uses for an unpriced / not-yet-sent quotation —
 * whose lines snapshot the buyer's GROUP price at submission time
 * (src/b2b/group-pricing.ts). Staff see and price DRAFT quotations in
 * the existing admin quotations list; sending one (DRAFT → SENT) is
 * still the staff action it always was, and conversion never
 * re-prices. There is deliberately NO new request table/model.
 *
 * SOURCE MARKER: Quotation has no source/note columns and this wave
 * changes no schema, so the request-only fields live in a companion
 * Setting doc `b2b.rfq_requests` = { requests: { [quotationId]: meta } }
 * (cap: newest 1,000 entries). Its presence is how the admin list and
 * the portal tell a buyer RFQ from a staff-created DRAFT. This mirrors
 * the wave-42 privacy convention for customer-actor records: the
 * staff AuditLog keys actorId to the staff User FK, so a buyer
 * submission ALSO attempts an actorId:null AuditLog row — but this
 * doc, not the audit row, is the guaranteed record (meta carries
 * auditLogWritten so the gap is never silent).
 *
 * VALIDATION HONESTY: every submitted row comes back in the result —
 * valid, warning, or error with a code — and invalid rows are never
 * silently dropped. A request is created from the VALID rows only;
 * when no row is valid, nothing is created (422). Insufficient stock
 * is a WARNING, not an error: an RFQ reserves no stock, and staff may
 * source against it.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { writeAudit } from "@/lib/audit";
import { b2bStore } from "./db-store";
import {
  readB2bGroupsDoc,
  resolveB2bVariantPrice,
} from "./group-pricing";
import { quotationTotalPoisha } from "./service";
import type {
  B2bCustomer,
  B2bPricingSource,
  B2bQuotationRequestMeta,
  Quotation,
  QuotationLine,
} from "./types";

export const B2B_RFQ_REQUESTS_SETTING_KEY = "b2b.rfq_requests";
const RFQ_META_CAP = 1_000;
/** Placeholder validity for an unpriced request (see validUntilFor). */
const RFQ_VALIDITY_DAYS = 30;
export const B2B_BULK_MAX_ROWS = 500;
const MAX_LINE_QUANTITY = 1_000_000;

/* ------------------------------------------------------------------ */
/* Request-meta Setting doc                                            */
/* ------------------------------------------------------------------ */

const requestMetaSchema = z.object({
  source: z.literal("BUYER_RFQ"),
  channel: z.enum(["PORTAL_FORM", "BULK_CSV"]),
  note: z.string().max(2_000),
  desiredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  submittedAt: z.string().min(1),
  submittedByCustomerId: z.string().min(1),
  auditLogWritten: z.boolean(),
});

const requestMetaDocSchema = z.object({
  requests: z.record(z.string().min(1), requestMetaSchema),
});

export async function readB2bRequestMetaMap(): Promise<Record<string, B2bQuotationRequestMeta>> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: B2B_RFQ_REQUESTS_SETTING_KEY } });
    if (row === null || row.value.trim() === "") return {};
    const parsed = requestMetaDocSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data.requests : {};
  } catch {
    // Corrupt doc reads as "no markers" rather than breaking the
    // quotation lists that enrich from it.
    return {};
  }
}

export async function getB2bRequestMeta(
  quotationId: string,
): Promise<B2bQuotationRequestMeta | null> {
  const map = await readB2bRequestMetaMap();
  return map[quotationId] ?? null;
}

async function recordB2bRequestMeta(
  quotationId: string,
  meta: B2bQuotationRequestMeta,
): Promise<void> {
  const current = await readB2bRequestMetaMap();
  const entries = Object.entries({ ...current, [quotationId]: meta })
    .sort((a, b) => b[1].submittedAt.localeCompare(a[1].submittedAt))
    .slice(0, RFQ_META_CAP);
  const doc = { requests: Object.fromEntries(entries) };
  const value = JSON.stringify(doc);
  await prisma.setting.upsert({
    where: { key: B2B_RFQ_REQUESTS_SETTING_KEY },
    create: {
      key: B2B_RFQ_REQUESTS_SETTING_KEY,
      value,
      valueEncrypted: false,
      isPublic: false,
      category: "b2b",
      description: "B2B buyer RFQ markers (JSON, ADV-14): source/note/desired-date per quotation id",
      updatedById: meta.submittedByCustomerId,
    },
    update: { value, valueEncrypted: false, updatedById: meta.submittedByCustomerId },
  });
}

/* ------------------------------------------------------------------ */
/* Row resolution against the catalogue                                */
/* ------------------------------------------------------------------ */

export interface B2bRequestRowInput {
  /** 1-based source line (CSV line number, or form row number). */
  rowNumber: number;
  sku?: string;
  variantId?: string;
  /** Number (form) or raw string (CSV) — the resolver validates it. */
  quantity?: unknown;
  /** Problems found before catalogue lookup (CSV shape errors). */
  parseErrors?: string[];
}

export interface B2bRequestRowIssue {
  code: string;
  message: string;
}

export interface B2bRequestRowResult {
  rowNumber: number;
  /** Canonical catalogue SKU once resolved; the submitted SKU otherwise. */
  sku: string | null;
  variantId: string | null;
  quantity: number | null;
  status: "valid" | "error";
  errors: B2bRequestRowIssue[];
  warnings: B2bRequestRowIssue[];
  productName?: string;
  /** Group-priced snapshot for this row's variant (valid rows). */
  unitPricePoisha?: number;
  pricingSource?: B2bPricingSource;
}

export interface B2bResolvedRequestRows {
  rows: B2bRequestRowResult[];
  /** Aggregated quotation lines (duplicate variants combined). */
  lines: QuotationLine[];
  totalPoisha: number;
  validCount: number;
  errorCount: number;
}

function parseQuantity(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw > 0 && raw <= MAX_LINE_QUANTITY ? raw : null;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const value = Number(raw.trim());
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_LINE_QUANTITY ? value : null;
  }
  return null;
}

type CatalogueVariant = Awaited<ReturnType<typeof fetchVariantsByIds>>[number];

function fetchVariantsByIds(ids: string[]) {
  return prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, sku: true, pricePoisha: true, stock: true, isActive: true, deletedAt: true,
      product: {
        select: {
          id: true, titleBn: true, titleEn: true, status: true,
          deletedAt: true, publishAt: true, priceOnRequest: true,
        },
      },
    },
  });
}

function fetchVariantsBySkus(skus: string[]) {
  return prisma.productVariant.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true, sku: true, pricePoisha: true, stock: true, isActive: true, deletedAt: true,
      product: {
        select: {
          id: true, titleBn: true, titleEn: true, status: true,
          deletedAt: true, publishAt: true, priceOnRequest: true,
        },
      },
    },
  });
}

/**
 * Validate EVERY input row against the catalogue and price the valid
 * ones for this buyer (group resolver). Nothing is dropped: each
 * input produces exactly one result row, in submission order.
 */
export async function resolveB2bRequestRows(
  profile: B2bCustomer,
  inputs: B2bRequestRowInput[],
): Promise<B2bResolvedRequestRows> {
  const groupsDoc = await readB2bGroupsDoc();
  const wantedIds = [...new Set(inputs.map((i) => i.variantId?.trim()).filter((v): v is string => Boolean(v)))];
  const wantedSkus = [...new Set(inputs.map((i) => i.sku?.trim()).filter((v): v is string => Boolean(v)))];
  const [byIdRows, bySkuRows] = await Promise.all([
    wantedIds.length > 0 ? fetchVariantsByIds(wantedIds) : Promise.resolve([] as CatalogueVariant[]),
    wantedSkus.length > 0 ? fetchVariantsBySkus(wantedSkus) : Promise.resolve([] as CatalogueVariant[]),
  ]);
  const byId = new Map<string, CatalogueVariant>(byIdRows.map((v) => [v.id, v]));
  const bySku = new Map<string, CatalogueVariant>(bySkuRows.map((v) => [v.sku, v]));

  const now = new Date();
  const rows: B2bRequestRowResult[] = [];
  const lineByVariant = new Map<string, QuotationLine>();

  for (const input of inputs) {
    const errors: B2bRequestRowIssue[] = (input.parseErrors ?? []).map((message) => ({
      code: "CSV_PARSE_ERROR",
      message,
    }));
    const warnings: B2bRequestRowIssue[] = [];
    const sku = input.sku?.trim() ? input.sku.trim() : null;
    const variantIdInput = input.variantId?.trim() ? input.variantId.trim() : null;
    const quantity = parseQuantity(input.quantity);

    if (sku === null && variantIdInput === null) {
      errors.push({ code: "MISSING_VARIANT", message: "No SKU or variant id was supplied for this row." });
    }
    if (quantity === null) {
      errors.push({
        code: "INVALID_QUANTITY",
        message: `Quantity must be a whole number between 1 and ${MAX_LINE_QUANTITY}.`,
      });
    }

    let variant: CatalogueVariant | undefined;
    if (variantIdInput !== null) variant = byId.get(variantIdInput);
    if (sku !== null) {
      const bySkuVariant = bySku.get(sku);
      if (bySkuVariant === undefined) {
        errors.push({ code: "UNKNOWN_SKU", message: `Unknown SKU: ${sku}` });
      } else if (variant && bySkuVariant.id !== variant.id) {
        errors.push({
          code: "SKU_VARIANT_MISMATCH",
          message: `SKU ${sku} belongs to a different variant than the supplied variant id.`,
        });
      }
      variant = variant ?? bySkuVariant;
    }
    if (variant === undefined && errors.length === 0) {
      errors.push(
        variantIdInput !== null && sku === null
          ? { code: "UNKNOWN_VARIANT", message: `Unknown variant id: ${variantIdInput}` }
          : { code: "UNKNOWN_SKU", message: `Unknown SKU: ${sku ?? ""}` },
      );
    }

    if (variant !== undefined) {
      if (variant.deletedAt !== null || !variant.isActive) {
        errors.push({ code: "INACTIVE_VARIANT", message: `Variant ${variant.sku} is inactive.` });
      }
      if (variant.product.deletedAt !== null || variant.product.status !== "ACTIVE") {
        errors.push({
          code: "INACTIVE_PRODUCT",
          message: `Product for SKU ${variant.sku} is not an ACTIVE product (status ${variant.product.status}).`,
        });
      } else if (variant.product.publishAt !== null && variant.product.publishAt > now) {
        errors.push({
          code: "NOT_YET_LIVE",
          message: `Product for SKU ${variant.sku} is scheduled for a future publish date.`,
        });
      }
    }

    if (variant === undefined || quantity === null || errors.length > 0) {
      rows.push({
        rowNumber: input.rowNumber,
        sku: variant?.sku ?? sku,
        variantId: variant?.id ?? variantIdInput,
        quantity,
        status: "error",
        errors,
        warnings,
      });
      continue;
    }

    const resolved = resolveB2bVariantPrice(groupsDoc, profile.id, {
      id: variant.id,
      pricePoisha: variant.pricePoisha,
    });
    if (variant.product.priceOnRequest) {
      warnings.push({
        code: "PRICE_ON_REQUEST",
        message: "This product is normally price-on-request; the B2B group price is snapshotted for staff review.",
      });
    }
    if (quantity > variant.stock) {
      warnings.push({
        code: "INSUFFICIENT_STOCK",
        message: `Requested ${quantity} but current stock is ${variant.stock} — no stock is reserved by an RFQ; staff may need to source.`,
      });
    }
    const existing = lineByVariant.get(variant.id);
    if (existing) {
      existing.quantity += quantity;
      warnings.push({
        code: "DUPLICATE_COMBINED",
        message: `SKU ${variant.sku} appears more than once — quantities are combined into one quotation line.`,
      });
    } else {
      lineByVariant.set(variant.id, {
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.titleBn || variant.product.titleEn,
        quantity,
        unitPricePoisha: resolved.effectivePricePoisha,
      });
    }
    rows.push({
      rowNumber: input.rowNumber,
      sku: variant.sku,
      variantId: variant.id,
      quantity,
      status: "valid",
      errors,
      warnings,
      productName: variant.product.titleBn || variant.product.titleEn,
      unitPricePoisha: resolved.effectivePricePoisha,
      pricingSource: resolved.pricingSource,
    });
  }

  const lines = [...lineByVariant.values()];
  return {
    rows,
    lines,
    totalPoisha: quotationTotalPoisha(lines),
    validCount: rows.filter((r) => r.status === "valid").length,
    errorCount: rows.filter((r) => r.status === "error").length,
  };
}

/* ------------------------------------------------------------------ */
/* Bulk CSV parsing                                                    */
/* ------------------------------------------------------------------ */

interface CsvRecord {
  lineNumber: number;
  fields: string[];
}

/** Small RFC-4180-enough parser: quotes, escaped quotes, CRLF, BOM. */
function parseCsvRecords(text: string): { records: CsvRecord[]; fatalError: string | null } {
  const records: CsvRecord[] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let fieldQuoted = false;
  let line = 1;
  let recordLine = 1;
  const src = text.replace(/^\uFEFF/, "");

  const endRecord = () => {
    record.push(field);
    records.push({ lineNumber: recordLine, fields: record });
    record = [];
    field = "";
    fieldQuoted = false;
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === "" && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
      fieldQuoted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      line += 1;
      endRecord();
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (inQuotes) return { records: [], fatalError: "CSV has an unterminated quoted field." };
  if (field !== "" || record.length > 0) endRecord();
  return { records, fatalError: null };
}

/**
 * Parse a bulk-order CSV (`sku,quantity` per row; header optional,
 * `variant_sku` accepted as the first header name). Returns resolver
 * inputs — per-row shape problems ride along as parseErrors so they
 * are reported, never dropped.
 */
export function parseB2bBulkCsv(csvText: string): {
  inputs: B2bRequestRowInput[];
  fatalError: string | null;
} {
  if (csvText.trim() === "") return { inputs: [], fatalError: "CSV is empty." };
  const { records, fatalError } = parseCsvRecords(csvText);
  if (fatalError !== null) return { inputs: [], fatalError };
  if (records.length === 0) return { inputs: [], fatalError: "CSV has no rows." };

  let dataRecords = records;
  const first = records[0] as CsvRecord;
  const firstCells = first.fields.map((f) => f.trim().toLowerCase());
  const isHeader =
    (firstCells[0] === "sku" || firstCells[0] === "variant_sku" || firstCells[0] === "variant sku") &&
    firstCells[1] === "quantity";
  if (isHeader) {
    dataRecords = records.slice(1);
  } else if (firstCells[0]?.includes("sku") || firstCells[1] === "quantity") {
    return {
      inputs: [],
      fatalError: "Unsupported CSV header — the first row must be exactly: sku,quantity",
    };
  }
  if (dataRecords.length === 0) return { inputs: [], fatalError: "CSV has a header but no data rows." };
  if (dataRecords.length > B2B_BULK_MAX_ROWS) {
    return {
      inputs: [],
      fatalError: `Too many rows: ${dataRecords.length}. At most ${B2B_BULK_MAX_ROWS} rows per bulk submission.`,
    };
  }

  const inputs: B2bRequestRowInput[] = dataRecords.map((record) => {
    const fields = record.fields;
    if (fields.length === 1 && (fields[0] ?? "").trim() === "") {
      return { rowNumber: record.lineNumber, parseErrors: ["Empty row."] };
    }
    if (fields.length !== 2) {
      return {
        rowNumber: record.lineNumber,
        parseErrors: [`Expected 2 columns (sku,quantity) but found ${fields.length}.`],
      };
    }
    return {
      rowNumber: record.lineNumber,
      sku: (fields[0] ?? "").trim(),
      quantity: (fields[1] ?? "").trim(),
    };
  });
  return { inputs, fatalError: null };
}

/* ------------------------------------------------------------------ */
/* Creation                                                            */
/* ------------------------------------------------------------------ */

/**
 * The stored validUntil is a QUOTE validity placeholder: an RFQ is
 * not an offer, but the Quotation contract requires a date. It is the
 * later of (submission + 30 days) and the buyer's desired date, so a
 * request never "expires" before the date the buyer asked for.
 */
function validUntilFor(desiredDate: string | null): string {
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + RFQ_VALIDITY_DAYS);
  const baseIso = base.toISOString().slice(0, 10);
  return desiredDate !== null && desiredDate > baseIso ? desiredDate : baseIso;
}

export type CreateB2bQuotationRequestResult =
  | {
      ok: true;
      httpStatus: 201;
      quotation: Quotation;
      meta: B2bQuotationRequestMeta;
      resolution: B2bResolvedRequestRows;
    }
  | {
      ok: false;
      httpStatus: number;
      code: string;
      message: string;
      resolution?: B2bResolvedRequestRows;
    };

export async function createB2bQuotationRequest(input: {
  customerId: string;
  profile: B2bCustomer;
  inputs: B2bRequestRowInput[];
  note?: string;
  desiredDate?: string | null;
  channel: B2bQuotationRequestMeta["channel"];
}): Promise<CreateB2bQuotationRequestResult> {
  const resolution = await resolveB2bRequestRows(input.profile, input.inputs);
  if (resolution.lines.length === 0) {
    return {
      ok: false,
      httpStatus: 422,
      code: "NO_VALID_ROWS",
      message:
        "কোনো বৈধ পণ্যের সারি পাওয়া যায়নি — কোনো RFQ তৈরি হয়নি। প্রতিটি সারির সমস্যা নিচে দেওয়া আছে। / No valid product rows — no RFQ was created. Every row's problem is listed below.",
      resolution,
    };
  }

  const now = new Date().toISOString();
  const quotation: Quotation = {
    id: `quo_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    b2bCustomerId: input.profile.id,
    lines: resolution.lines,
    totalPoisha: resolution.totalPoisha,
    status: "DRAFT",
    validUntil: validUntilFor(input.desiredDate ?? null),
    createdAt: now,
    updatedAt: now,
  };
  const saved = await b2bStore.addQuotation(quotation);

  // Companion AuditLog attempt with actorId: null (the wave-42
  // convention for customer actors — writeAudit can never key a
  // customer id to the staff User FK). The Setting-doc marker below
  // is the guaranteed record either way.
  const auditId = await writeAudit({
    actorId: null,
    action: "b2b.quotation_requested",
    entityType: "Quotation",
    entityId: saved.id,
    afterJson: {
      source: "BUYER_RFQ",
      channel: input.channel,
      b2bCustomerId: input.profile.id,
      submittedByCustomerId: input.customerId,
      totalPoisha: saved.totalPoisha,
      lineCount: saved.lines.length,
      rowsWithErrors: resolution.errorCount,
    },
  });

  const meta: B2bQuotationRequestMeta = {
    source: "BUYER_RFQ",
    channel: input.channel,
    note: (input.note ?? "").trim(),
    desiredDate: input.desiredDate ?? null,
    submittedAt: now,
    submittedByCustomerId: input.customerId,
    auditLogWritten: auditId !== null,
  };
  try {
    await recordB2bRequestMeta(saved.id, meta);
  } catch {
    // Without its source marker the row would masquerade as a
    // staff-created draft — roll the quotation back (soft delete)
    // rather than leave an unmarked buyer request behind.
    await prisma.quotation.update({
      where: { id: saved.id },
      data: { deletedAt: new Date() },
    }).catch(() => {});
    return {
      ok: false,
      httpStatus: 503,
      code: "REQUEST_RECORD_FAILED",
      message:
        "RFQ সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন। / The RFQ could not be recorded — please try again.",
      resolution,
    };
  }

  return { ok: true, httpStatus: 201, quotation: saved, meta, resolution };
}
