/**
 * Courier invoice CSV importer + accountant dispute workflow — Agent 50.
 * Builds on src/bd/courier-reconciliation.ts (Agent 11, E4) — that module
 * is imported, never modified.
 *
 * THE GAP THIS CLOSES: reconciliation existed, but there was no way to
 * get a real courier invoice INTO it, and no workflow for an accountant
 * to chase a disputed row. This module adds both.
 *
 * ── Invoice CSV format ────────────────────────────────────────────────
 * Header row is required, exactly these columns (case-insensitive,
 * order-independent; unknown columns are ignored):
 *
 *   trackingId,orderId,codCollected,deliveryCharge,codFee,returnCharge,status
 *
 *   trackingId    courier tracking id — the join key to our shipments
 *   orderId       our order id as printed by the courier (cross-checked
 *                 against our shipment's orderId; a mismatch is reported
 *                 as a warning, never silently "fixed")
 *   codCollected  taka decimal string, e.g. "1250.50" — converted to
 *                 integer poisha by STRING parsing (see below), no floats
 *   deliveryCharge / codFee / returnCharge — same taka format;
 *                 codFee and returnCharge may be empty (= 0)
 *   status        delivered | returned | failed | in_transit | partial
 *                 (case-insensitive; informational — reconciliation
 *                 decides matched/disputed from the money, not this)
 *
 * ── Money ─────────────────────────────────────────────────────────────
 * Taka → poisha is done by splitting the decimal string and padding the
 * fraction to 2 digits. No parseFloat anywhere: "0.1 + 0.2" style float
 * error can never enter a reconciliation.
 *
 * ── No silent drops (same rule as the catalog importer) ───────────────
 * Every data row ends up exactly one of: valid (fed to reconciliation),
 * or invalid with row-numbered errors (bad money, missing field, bad
 * status, duplicate trackingId in this file, or trackingId already
 * imported in an earlier run for the same courier). An error-report CSV
 * is produced for the invalid rows.
 *
 * ── Disputes ──────────────────────────────────────────────────────────
 * A dispute is created FROM a disputed reconciliation row, with a
 * mandatory reason. Flow:
 *   OPEN -> EVIDENCE_ATTACHED -> SUBMITTED -> ACCEPTED | REJECTED -> CLOSED
 * (OPEN may also go straight to SUBMITTED when there is no evidence to
 * attach.) A dispute NEVER edits the expected or invoiced amounts — it
 * carries read-only snapshots of both. If a dispute is ACCEPTED with an
 * agreed amount, that agreement is recorded as a SEPARATE
 * DisputeAdjustment record; the original row amounts stay untouched.
 *
 * Persistence: DB-backed since 2026-10-24 (the store section at the
 * bottom of this file) — run headers, disputes and adjustments persist
 * in courier_invoice_runs / courier_disputes / dispute_adjustments.
 *
 * SCHEMA DRIFT (reported, worked around — schema NOT changed):
 *  - The schema has no table for a run's reconciled ROWS (nor for the
 *    invalid-row detail / error-report CSV / imported tracking-id set):
 *    run headers persist; row detail lives in a process-local cache and
 *    is re-derivable only by re-import. Dispute history entries,
 *    dispute createdBy, and adjustment note/recordedBy/shipmentId have
 *    no columns either — they survive in the same cache in-process and
 *    read back reduced after a restart.
 *  - CourierDispute.expectedPoisha / invoicedPoisha are NOT NULL: a
 *    missing side (missing_in_invoice / extra_in_invoice) is stored as
 *    0 — semantically "nothing invoiced / nothing expected".
 */
import { z } from "zod";
import { parseCsv, buildErrorReportCsv, type ImportRowError } from "../catalog/import";
import {
  reconcileCourierInvoice,
  type CourierInvoiceRow,
  type CourierReconciliation,
  type ExpectedShipment,
  type ReconciledRow,
} from "./courier-reconciliation";
import { courierChargePoisha } from "../integrations/sandbox/courier-provider";
import type { SandboxShipment } from "../integrations/sandbox/store";
import { findShipmentCharge, listShipments } from "../integrations/sandbox/db-store";

// ── CSV row parsing ───────────────────────────────────────────────────

export const COURIER_INVOICE_HEADERS = [
  "trackingid",
  "orderid",
  "codcollected",
  "deliverycharge",
  "codfee",
  "returncharge",
  "status",
] as const;

const REQUIRED_HEADERS = ["trackingid", "orderid", "codcollected", "deliverycharge", "status"] as const;

export const invoiceStatuses = ["DELIVERED", "RETURNED", "FAILED", "IN_TRANSIT", "PARTIAL"] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

function normalizeStatus(raw: string): InvoiceStatus | null {
  const s = raw.trim().toUpperCase().replace(/[\s-]+/g, "_");
  return (invoiceStatuses as readonly string[]).includes(s) ? (s as InvoiceStatus) : null;
}

/**
 * Convert a taka decimal string to integer poisha by string parsing.
 * Accepts "1250", "1250.5", "1250.50", thousands separators ("1,250.50"
 * — arrives quoted in CSV) and an optional leading "৳". Returns null for
 * anything malformed, negative, or with more than 2 decimal places
 * (a 3-decimal taka value cannot be represented exactly in poisha —
 * rejecting it beats rounding money silently).
 */
export function takaStringToPoisha(raw: string): number | null {
  const cleaned = raw.trim().replace(/^৳/, "").replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const takaPart = match[1] as string;
  if (takaPart.length > 13) return null; // would leave safe-integer range once ×100
  const frac = (match[2] ?? "").padEnd(2, "0");
  const poisha = Number(takaPart) * 100 + Number(frac);
  return Number.isSafeInteger(poisha) ? poisha : null;
}

const parsedRowSchema = z.object({
  trackingId: z.string().min(1),
  orderId: z.string().min(1),
  codCollectedPoisha: z.number().int().nonnegative(),
  deliveryChargePoisha: z.number().int().nonnegative(),
  codFeePoisha: z.number().int().nonnegative(),
  returnChargePoisha: z.number().int().nonnegative(),
  status: z.enum(invoiceStatuses),
});

export type ParsedInvoiceRow = z.infer<typeof parsedRowSchema>;

export interface InvalidInvoiceRow {
  row: number; // file row number (header = 1, first data row = 2)
  raw: Record<string, string>;
  errors: ImportRowError[];
}

export interface OrderIdMismatch {
  row: number;
  trackingId: string;
  invoiceOrderId: string;
  expectedOrderId: string;
}

export interface CourierInvoiceImport {
  totalRows: number;
  validRows: ParsedInvoiceRow[];
  invalidRows: InvalidInvoiceRow[];
  errorReportCsv: string;
  orderIdMismatches: OrderIdMismatch[];
}

/**
 * Parse + validate an invoice CSV. `alreadyImported` holds the
 * trackingIds imported in earlier runs FOR THIS COURIER — a repeat is an
 * invalid row (duplicate), never a silent overwrite. `expectedByTracking`
 * is used only for the orderId cross-check warning.
 */
export function parseCourierInvoiceCsv(
  csvText: string,
  alreadyImported: ReadonlySet<string>,
  expectedByTracking: ReadonlyMap<string, ExpectedShipment>,
): CourierInvoiceImport {
  const { headers, rows } = parseCsv(csvText);
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    const invalidRows = rows.map((raw, idx) => ({
      row: idx + 2,
      raw,
      errors: missing.map((f) => ({
        row: idx + 2,
        field: f,
        message: `Missing required column: ${f}`,
      })),
    }));
    return {
      totalRows: rows.length,
      validRows: [],
      invalidRows,
      errorReportCsv: buildErrorReportCsv(invalidRows),
      orderIdMismatches: [],
    };
  }

  const validRows: ParsedInvoiceRow[] = [];
  const invalidRows: InvalidInvoiceRow[] = [];
  const orderIdMismatches: OrderIdMismatch[] = [];
  const seenInFile = new Set<string>();

  rows.forEach((raw, idx) => {
    const rowNo = idx + 2;
    const errors: ImportRowError[] = [];
    const trackingId = (raw.trackingid ?? "").trim();
    const orderId = (raw.orderid ?? "").trim();

    const money = (field: string, value: string, optional: boolean): number => {
      if (value.trim() === "" && optional) return 0;
      const parsed = takaStringToPoisha(value);
      if (parsed === null) {
        errors.push({
          row: rowNo,
          field,
          message: `Invalid taka amount: "${value}" (expected e.g. 1250.50, max 2 decimals, non-negative)`,
        });
        return 0;
      }
      return parsed;
    };

    const codCollectedPoisha = money("codCollected", raw.codcollected ?? "", false);
    const deliveryChargePoisha = money("deliveryCharge", raw.deliverycharge ?? "", false);
    const codFeePoisha = money("codFee", raw.codfee ?? "", true);
    const returnChargePoisha = money("returnCharge", raw.returncharge ?? "", true);

    const status = normalizeStatus(raw.status ?? "");
    if (status === null) {
      errors.push({
        row: rowNo,
        field: "status",
        message: `Unknown invoice status: "${raw.status ?? ""}" (expected one of ${invoiceStatuses.join(", ")})`,
      });
    }

    if (trackingId) {
      if (seenInFile.has(trackingId)) {
        errors.push({ row: rowNo, field: "trackingId", message: `Duplicate trackingId in file: ${trackingId}` });
      }
      if (alreadyImported.has(trackingId)) {
        errors.push({
          row: rowNo,
          field: "trackingId",
          message: `trackingId already imported in an earlier run: ${trackingId}`,
        });
      }
      seenInFile.add(trackingId);
    }

    const parsed = parsedRowSchema.safeParse({
      trackingId,
      orderId,
      codCollectedPoisha,
      deliveryChargePoisha,
      codFeePoisha,
      returnChargePoisha,
      status: status ?? "DELIVERED",
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ row: rowNo, field: issue.path.join(".") || "row", message: issue.message });
      }
    }

    if (errors.length > 0 || !parsed.success) {
      invalidRows.push({ row: rowNo, raw, errors });
      return;
    }
    validRows.push(parsed.data);
    const expected = expectedByTracking.get(trackingId);
    if (expected && expected.orderId !== orderId) {
      orderIdMismatches.push({ row: rowNo, trackingId, invoiceOrderId: orderId, expectedOrderId: expected.orderId });
    }
  });

  return {
    totalRows: rows.length,
    validRows,
    invalidRows,
    errorReportCsv: buildErrorReportCsv(invalidRows),
    orderIdMismatches,
  };
}

// ── Expected rows from the sandbox shipment / COD shapes ─────────────

/**
 * Build reconciliation "expected" rows from the persisted shipments of
 * one courier, mirroring src/integrations/sandbox/cod-settlement.ts:
 * the charge is the Shipment row's stored chargePoisha (the real
 * courierChargePoisha() output from booking); rows without a stored
 * charge fall back to courierChargePoisha("district", weightGrams)
 * (the sandbox carries no zone, so the district base is used — same
 * caveat as the COD settlement report). DELIVERED shipments expect the
 * COD amount minus the delivery charge; RETURNED shipments expect no
 * COD and a return charge equal to that charge. Shipments in any other
 * status are not billable yet and are counted as skipped, never dropped
 * silently.
 */
export async function buildExpectedFromSandbox(courierKey: string): Promise<{
  expected: ExpectedShipment[];
  skippedCount: number;
}> {
  const expected: ExpectedShipment[] = [];
  let skippedCount = 0;
  const shipments = await listShipments(courierKey);
  for (const shipment of shipments) {
    const storedCharge = await findShipmentCharge(shipment.shipmentId);
    const built = expectedFromSandboxShipment(shipment, storedCharge > 0 ? storedCharge : undefined);
    if (built) expected.push(built);
    else skippedCount++;
  }
  return { expected, skippedCount };
}

export function expectedFromSandboxShipment(
  shipment: SandboxShipment,
  chargeOverride?: number,
): ExpectedShipment | null {
  const charge = chargeOverride ?? courierChargePoisha("district", shipment.weightGrams);
  if (shipment.status === "DELIVERED") {
    return {
      shipmentId: shipment.shipmentId,
      orderId: shipment.orderId,
      trackingId: shipment.trackingId,
      provider: shipment.provider,
      codCollectedPoisha: shipment.codAmountPoisha,
      deliveryChargePoisha: charge,
      codFeePoisha: 0,
      returnChargePoisha: 0,
    };
  }
  if (shipment.status === "RETURNED") {
    return {
      shipmentId: shipment.shipmentId,
      orderId: shipment.orderId,
      trackingId: shipment.trackingId,
      provider: shipment.provider,
      codCollectedPoisha: 0,
      deliveryChargePoisha: 0,
      codFeePoisha: 0,
      returnChargePoisha: charge,
    };
  }
  return null;
}

// ── Import + reconcile run ────────────────────────────────────────────

export interface RunRow extends ReconciledRow {
  /** Stable id within the run: `${runId}:${shipmentId}` — disputes point at this. */
  rowId: string;
}

export interface CourierInvoiceRun {
  runId: string;
  courierKey: string;
  importedAt: string;
  totalRows: number;
  validRowCount: number;
  invalidRows: InvalidInvoiceRow[];
  errorReportCsv: string;
  orderIdMismatches: OrderIdMismatch[];
  skippedShipments: number;
  /** trackingIds of the valid rows in this run (feeds duplicate detection on later imports). */
  importedTrackingIds: string[];
  rows: RunRow[];
  summary: CourierReconciliation["summary"];
  /** Always this literal for the current implementation. */
  persistence: "database";
}

let runSeq = 0;

/**
 * Full pipeline: parse the CSV, resolve each valid row's trackingId to
 * our shipmentId (unknown trackingIds get an `unknown:` shipmentId so
 * the existing reconciliation reports them as extra_in_invoice), then
 * run the EXISTING reconcileCourierInvoice unchanged.
 */
export function runCourierInvoiceImport(input: {
  courierKey: string;
  csvText: string;
  expected: ExpectedShipment[];
  skippedShipments?: number;
  alreadyImported: ReadonlySet<string>;
  now?: Date;
}): CourierInvoiceRun {
  const now = input.now ?? new Date();
  const runId = `cir-${now.getTime().toString(36)}-${++runSeq}`;
  const expectedByTracking = new Map<string, ExpectedShipment>();
  for (const e of input.expected) {
    if (e.trackingId) expectedByTracking.set(e.trackingId, e);
  }

  const parsed = parseCourierInvoiceCsv(input.csvText, input.alreadyImported, expectedByTracking);

  const invoiceRows: CourierInvoiceRow[] = parsed.validRows.map((row) => {
    const expected = expectedByTracking.get(row.trackingId);
    return {
      shipmentId: expected?.shipmentId ?? `unknown:${row.trackingId}`,
      trackingId: row.trackingId,
      codCollectedPoisha: row.codCollectedPoisha,
      deliveryChargePoisha: row.deliveryChargePoisha,
      codFeePoisha: row.codFeePoisha,
      returnChargePoisha: row.returnChargePoisha,
    };
  });

  const reconciliation = reconcileCourierInvoice(input.expected, invoiceRows);
  return {
    runId,
    courierKey: input.courierKey,
    importedAt: now.toISOString(),
    totalRows: parsed.totalRows,
    validRowCount: parsed.validRows.length,
    invalidRows: parsed.invalidRows,
    errorReportCsv: parsed.errorReportCsv,
    orderIdMismatches: parsed.orderIdMismatches,
    skippedShipments: input.skippedShipments ?? 0,
    importedTrackingIds: parsed.validRows.map((r) => r.trackingId),
    rows: reconciliation.rows.map((r) => ({ ...r, rowId: `${runId}:${r.shipmentId}` })),
    summary: reconciliation.summary,
    persistence: "database",
  };
}

// ── Dispute workflow ──────────────────────────────────────────────────

export const disputeStatuses = [
  "OPEN",
  "EVIDENCE_ATTACHED",
  "SUBMITTED",
  "ACCEPTED",
  "REJECTED",
  "CLOSED",
] as const;
export type DisputeStatus = (typeof disputeStatuses)[number];

const DISPUTE_TRANSITIONS: Record<DisputeStatus, readonly DisputeStatus[]> = {
  OPEN: ["EVIDENCE_ATTACHED", "SUBMITTED"],
  EVIDENCE_ATTACHED: ["SUBMITTED"],
  SUBMITTED: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: [],
};

export interface DisputeHistoryEntry {
  from: DisputeStatus | null;
  to: DisputeStatus;
  at: string;
  by: string;
  note: string | null;
}

export interface CourierDispute {
  disputeId: string;
  runId: string;
  rowId: string;
  shipmentId: string;
  courierKey: string;
  reason: string;
  status: DisputeStatus;
  evidenceRefs: string[];
  /** Read-only snapshots from the reconciled row — NEVER mutated. */
  expectedPayablePoisha: number | null;
  invoicedPayablePoisha: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: DisputeHistoryEntry[];
}

/**
 * Separate adjustment record — the ONLY place an agreed correction
 * lives. Created when a dispute is ACCEPTED with an adjustment; the
 * dispute and the reconciled row keep their original amounts.
 */
export interface DisputeAdjustment {
  adjustmentId: string;
  disputeId: string;
  shipmentId: string;
  /** courier_owes: courier pays us this much extra. merchant_owes: we accept owing the courier. */
  direction: "courier_owes" | "merchant_owes";
  amountPoisha: number;
  note: string;
  recordedBy: string;
  recordedAt: string;
}

export type DisputeResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

let disputeSeq = 0;
let adjustmentSeq = 0;

/** Create a dispute from a DISPUTED run row. Reason is mandatory. */
export function createDispute(input: {
  run: CourierInvoiceRun;
  rowId: string;
  reason: string;
  createdBy: string;
  existingDisputes: readonly CourierDispute[];
  now?: Date;
}): DisputeResult<CourierDispute> {
  const reason = input.reason.trim();
  if (reason.length < 3) {
    return { ok: false, code: "REASON_REQUIRED", message: "A dispute reason of at least 3 characters is required." };
  }
  const row = input.run.rows.find((r) => r.rowId === input.rowId);
  if (!row) return { ok: false, code: "ROW_NOT_FOUND", message: `No reconciliation row with id ${input.rowId} in run ${input.run.runId}.` };
  if (!row.disputed) {
    return { ok: false, code: "ROW_NOT_DISPUTED", message: "A dispute can only be created from a disputed row." };
  }
  const open = input.existingDisputes.find((d) => d.rowId === input.rowId && d.status !== "CLOSED");
  if (open) {
    return { ok: false, code: "DISPUTE_ALREADY_OPEN", message: `Row already has a non-closed dispute (${open.disputeId}).` };
  }
  const now = (input.now ?? new Date()).toISOString();
  const dispute: CourierDispute = {
    disputeId: `dsp-${++disputeSeq}`,
    runId: input.run.runId,
    rowId: input.rowId,
    shipmentId: row.shipmentId,
    courierKey: input.run.courierKey,
    reason,
    status: "OPEN",
    evidenceRefs: [],
    expectedPayablePoisha: row.expectedPayablePoisha,
    invoicedPayablePoisha: row.invoicedPayablePoisha,
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
    history: [{ from: null, to: "OPEN", at: now, by: input.createdBy, note: reason }],
  };
  return { ok: true, value: dispute };
}

export interface DisputeTransitionInput {
  to: DisputeStatus;
  by: string;
  note?: string;
  /** Required when moving to EVIDENCE_ATTACHED (a file ref / link label — the file itself lives in storage, not here). */
  evidenceRef?: string;
  /** Only honoured on the ACCEPTED transition; recorded as a separate adjustment, never written onto the dispute amounts. */
  adjustment?: { direction: DisputeAdjustment["direction"]; amountPoisha: number; note: string };
}

/** Pure transition: returns a NEW dispute object; the input is not mutated. */
export function transitionDispute(
  dispute: CourierDispute,
  input: DisputeTransitionInput,
  now: Date = new Date(),
): DisputeResult<{ dispute: CourierDispute; adjustment: DisputeAdjustment | null }> {
  const allowed = DISPUTE_TRANSITIONS[dispute.status];
  if (!allowed.includes(input.to)) {
    return {
      ok: false,
      code: "INVALID_TRANSITION",
      message: `Cannot move a ${dispute.status} dispute to ${input.to}. Allowed: ${allowed.join(", ") || "(none — terminal)"}.`,
    };
  }
  if (input.to === "EVIDENCE_ATTACHED" && !(input.evidenceRef ?? "").trim()) {
    return { ok: false, code: "EVIDENCE_REQUIRED", message: "Attaching evidence requires an evidenceRef." };
  }
  if (input.adjustment && input.to !== "ACCEPTED") {
    return { ok: false, code: "ADJUSTMENT_ONLY_ON_ACCEPT", message: "An adjustment can only be recorded when a dispute is ACCEPTED." };
  }
  let adjustment: DisputeAdjustment | null = null;
  if (input.adjustment) {
    const { amountPoisha, direction, note } = input.adjustment;
    if (!Number.isInteger(amountPoisha) || amountPoisha <= 0 || !note.trim()) {
      return { ok: false, code: "INVALID_ADJUSTMENT", message: "Adjustment needs a positive integer poisha amount and a note." };
    }
    adjustment = {
      adjustmentId: `adj-${++adjustmentSeq}`,
      disputeId: dispute.disputeId,
      shipmentId: dispute.shipmentId,
      direction,
      amountPoisha,
      note: note.trim(),
      recordedBy: input.by,
      recordedAt: now.toISOString(),
    };
  }
  const at = now.toISOString();
  const next: CourierDispute = {
    ...dispute,
    status: input.to,
    evidenceRefs:
      input.to === "EVIDENCE_ATTACHED" && input.evidenceRef
        ? [...dispute.evidenceRefs, input.evidenceRef.trim()]
        : dispute.evidenceRefs,
    updatedAt: at,
    history: [
      ...dispute.history,
      { from: dispute.status, to: input.to, at, by: input.by, note: input.note?.trim() || null },
    ],
  };
  return { ok: true, value: { dispute: next, adjustment } };
}

// ── Prisma-backed store (DB swap 2026-10-24) ─────────────────────────
//
// Run HEADERS, disputes and adjustments persist in the DB tables. The
// full run detail (rows, invalid rows, error-report CSV), the dispute
// history and the imported-tracking-id set have no schema columns (see
// the module header's drift notes), so they are kept in a process-local
// detail cache alongside the DB writes; reads merge cache-first and
// fall back to the persisted header/rows.

import { prisma } from "@advance-ecommerce/db";

const runDetailCache = new Map<string, CourierInvoiceRun>();
const disputeDetailCache = new Map<string, CourierDispute>();
const adjustmentDetailCache = new Map<string, DisputeAdjustment>();
/** `${courierKey}:${trackingId}` imported in any earlier run (process-local; drift-noted). */
const importedTrackingIdSet = new Set<string>();

export async function importedTrackingIdsFor(courierKey: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (const key of importedTrackingIdSet) {
    const prefix = `${courierKey}:`;
    if (key.startsWith(prefix)) out.add(key.slice(prefix.length));
  }
  return out;
}

export async function recordRun(run: CourierInvoiceRun): Promise<void> {
  runDetailCache.set(run.runId, run);
  for (const trackingId of run.importedTrackingIds) {
    importedTrackingIdSet.add(`${run.courierKey}:${trackingId}`);
  }
  await prisma.courierInvoiceRun.create({
    data: {
      id: run.runId,
      courierKey: run.courierKey,
      rowsTotal: run.totalRows,
      rowsValid: run.validRowCount,
      matchedTotalPoisha: run.summary.matchedTotalPoisha,
      disputedTotalPoisha: run.summary.disputedTotalPoisha,
    },
  });
}

interface InvoiceRunRowShape {
  id: string;
  courierKey: string;
  rowsTotal: number;
  rowsValid: number;
  matchedTotalPoisha: number;
  disputedTotalPoisha: number;
  createdAt: Date;
}

function runHeaderToRun(row: InvoiceRunRowShape): CourierInvoiceRun {
  return {
    runId: row.id,
    courierKey: row.courierKey,
    importedAt: row.createdAt.toISOString(),
    totalRows: row.rowsTotal,
    validRowCount: row.rowsValid,
    invalidRows: [],
    errorReportCsv: "",
    orderIdMismatches: [],
    skippedShipments: 0,
    importedTrackingIds: [],
    rows: [],
    summary: {
      expectedTotalPoisha: row.matchedTotalPoisha + row.disputedTotalPoisha,
      invoicedTotalPoisha: row.matchedTotalPoisha + row.disputedTotalPoisha,
      matchedTotalPoisha: row.matchedTotalPoisha,
      disputedTotalPoisha: row.disputedTotalPoisha,
      matchedCount: 0,
      disputedCount: 0,
      missingCount: 0,
      extraCount: 0,
    },
    persistence: "database",
  };
}

export async function listInvoiceRuns(): Promise<CourierInvoiceRun[]> {
  const rows = await prisma.courierInvoiceRun.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((row) => runDetailCache.get(row.id) ?? runHeaderToRun(row));
}

export async function getInvoiceRun(runId: string): Promise<CourierInvoiceRun | null> {
  const cached = runDetailCache.get(runId);
  if (cached) return cached;
  const row = await prisma.courierInvoiceRun.findUnique({ where: { id: runId } });
  return row ? runHeaderToRun(row) : null;
}

/* ------------------------------ disputes ------------------------------ */

interface DisputeRowShape {
  id: string;
  runId: string;
  trackingId: string;
  expectedPoisha: number;
  invoicedPoisha: number;
  reason: string;
  status: string;
  evidenceRef: string | null;
  createdAt: Date;
}

async function disputeRowToTs(row: DisputeRowShape): Promise<CourierDispute> {
  const cached = disputeDetailCache.get(row.id);
  if (cached && cached.status === row.status) return cached;
  const shipment = await prisma.shipment.findUnique({
    where: { trackingId: row.trackingId },
    select: { id: true },
  });
  const shipmentId = shipment?.id ?? `unknown:${row.trackingId}`;
  const run = await prisma.courierInvoiceRun.findUnique({
    where: { id: row.runId },
    select: { courierKey: true },
  });
  return {
    disputeId: row.id,
    runId: row.runId,
    rowId: `${row.runId}:${shipmentId}`,
    shipmentId,
    courierKey: run?.courierKey ?? "",
    reason: row.reason,
    status: (disputeStatuses as readonly string[]).includes(row.status)
      ? (row.status as DisputeStatus)
      : "OPEN",
    evidenceRefs: row.evidenceRef ? [row.evidenceRef] : [],
    expectedPayablePoisha: row.expectedPoisha,
    invoicedPayablePoisha: row.invoicedPoisha,
    createdBy: cached?.createdBy ?? "",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.createdAt.toISOString(),
    history: cached?.history ?? [
      { from: null, to: (row.status as DisputeStatus) ?? "OPEN", at: row.createdAt.toISOString(), by: "", note: row.reason },
    ],
  };
}

async function trackingIdForDispute(dispute: CourierDispute): Promise<string> {
  if (dispute.shipmentId.startsWith("unknown:")) return dispute.shipmentId.slice("unknown:".length);
  const shipment = await prisma.shipment.findUnique({
    where: { id: dispute.shipmentId },
    select: { trackingId: true },
  });
  return shipment?.trackingId ?? dispute.shipmentId;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

export async function saveDispute(dispute: CourierDispute): Promise<CourierDispute> {
  const trackingId = await trackingIdForDispute(dispute);
  const data = {
    runId: dispute.runId,
    trackingId,
    expectedPoisha: dispute.expectedPayablePoisha ?? 0,
    invoicedPoisha: dispute.invoicedPayablePoisha ?? 0,
    reason: dispute.reason,
    status: dispute.status,
    evidenceRef: dispute.evidenceRefs[dispute.evidenceRefs.length - 1] ?? null,
  };
  try {
    await prisma.courierDispute.create({ data: { id: dispute.disputeId, ...data } });
    disputeDetailCache.set(dispute.disputeId, dispute);
    return dispute;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The process-local dsp-N sequence can collide with a persisted id
    // after a restart; suffix and retry once rather than losing the row.
    const created: CourierDispute = {
      ...dispute,
      disputeId: `${dispute.disputeId}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    };
    await prisma.courierDispute.create({ data: { id: created.disputeId, ...data } });
    disputeDetailCache.set(created.disputeId, created);
    return created;
  }
}

export async function updateDispute(dispute: CourierDispute): Promise<CourierDispute> {
  await prisma.courierDispute.update({
    where: { id: dispute.disputeId },
    data: {
      status: dispute.status,
      evidenceRef: dispute.evidenceRefs[dispute.evidenceRefs.length - 1] ?? null,
    },
  });
  disputeDetailCache.set(dispute.disputeId, dispute);
  return dispute;
}

export async function getDispute(disputeId: string): Promise<CourierDispute | null> {
  const row = await prisma.courierDispute.findUnique({ where: { id: disputeId } });
  return row ? disputeRowToTs(row) : null;
}

export async function listDisputes(): Promise<CourierDispute[]> {
  const rows = await prisma.courierDispute.findMany({ orderBy: { createdAt: "asc" } });
  return Promise.all(rows.map(disputeRowToTs));
}

/* ---------------------------- adjustments ----------------------------- */

interface AdjustmentRowShape {
  id: string;
  disputeId: string;
  direction: string;
  amountPoisha: number;
  createdAt: Date;
}

function adjustmentRowToTs(row: AdjustmentRowShape): DisputeAdjustment {
  const cached = adjustmentDetailCache.get(row.id);
  if (cached) return cached;
  return {
    adjustmentId: row.id,
    disputeId: row.disputeId,
    shipmentId: "",
    direction: row.direction as DisputeAdjustment["direction"],
    amountPoisha: row.amountPoisha,
    note: "",
    recordedBy: "",
    recordedAt: row.createdAt.toISOString(),
  };
}

export async function saveAdjustment(adjustment: DisputeAdjustment): Promise<DisputeAdjustment> {
  try {
    await prisma.disputeAdjustment.create({
      data: {
        id: adjustment.adjustmentId,
        disputeId: adjustment.disputeId,
        direction: adjustment.direction,
        amountPoisha: adjustment.amountPoisha,
      },
    });
    adjustmentDetailCache.set(adjustment.adjustmentId, adjustment);
    return adjustment;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const created: DisputeAdjustment = {
      ...adjustment,
      adjustmentId: `${adjustment.adjustmentId}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    };
    await prisma.disputeAdjustment.create({
      data: {
        id: created.adjustmentId,
        disputeId: created.disputeId,
        direction: created.direction,
        amountPoisha: created.amountPoisha,
      },
    });
    adjustmentDetailCache.set(created.adjustmentId, created);
    return created;
  }
}

export async function listAdjustments(): Promise<DisputeAdjustment[]> {
  const rows = await prisma.disputeAdjustment.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(adjustmentRowToTs);
}
