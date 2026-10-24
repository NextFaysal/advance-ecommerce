/**
 * Courier invoice reconciliation — Agent 11, Step 45 (E4). Pure logic,
 * integer poisha, inputs are NEVER mutated.
 *
 * When a courier (Steadfast / Pathao / RedX / Paperfly / eCourier) sends
 * its invoice for a batch of shipments, every row must agree with what
 * OUR shipments say should be payable:
 *
 *   expectedPayable = codCollected − deliveryCharge − codFee − returnCharge
 *
 * HARD RULE (the reason this module exists): a row that disagrees is
 * DISPUTED — it is listed, with its full expected and invoiced numbers,
 * and it is never silently adjusted. There is deliberately no code path
 * here that rewrites an expected value to match an invoice, and the
 * summary keeps matched money and disputed money in separate totals so
 * an accountant can pay the matched part and chase the disputed part.
 *
 * Statuses:
 *   matched            — payable and all charges agree
 *   amount_mismatch    — COD collected differs
 *   charge_mismatch    — a charge (delivery / COD fee / return) differs
 *   missing_in_invoice — we shipped it, the courier did not bill it
 *   extra_in_invoice   — the courier billed a shipment we do not have
 *   tracking_mismatch  — same shipment id, different tracking id
 *
 * Test case: expected { cod 100000, delivery 6000 } -> payable 94000.
 *  invoice { cod 100000, delivery 7000, payable 93000 } ->
 *    status charge_mismatch, disputed true, difference -1000,
 *    expectedPayable STILL 94000 in the output row.
 *  invoice row for an unknown shipment -> extra_in_invoice, disputed.
 *  expected row with no invoice row -> missing_in_invoice, disputed.
 */
import { z } from "zod";

export const expectedShipmentSchema = z.object({
  shipmentId: z.string().min(1),
  orderId: z.string().min(1),
  trackingId: z.string().min(1).optional(),
  provider: z.string().min(1),
  codCollectedPoisha: z.number().int().nonnegative(),
  deliveryChargePoisha: z.number().int().nonnegative(),
  codFeePoisha: z.number().int().nonnegative().default(0),
  returnChargePoisha: z.number().int().nonnegative().default(0),
});

export type ExpectedShipment = z.infer<typeof expectedShipmentSchema>;

export const courierInvoiceRowSchema = z.object({
  shipmentId: z.string().min(1),
  trackingId: z.string().min(1).optional(),
  codCollectedPoisha: z.number().int().nonnegative(),
  deliveryChargePoisha: z.number().int().nonnegative(),
  codFeePoisha: z.number().int().nonnegative().default(0),
  returnChargePoisha: z.number().int().nonnegative().default(0),
  /** Payable as printed on the courier invoice, when the invoice shows one. */
  invoicedPayablePoisha: z.number().int().nonnegative().optional(),
});

export type CourierInvoiceRow = z.infer<typeof courierInvoiceRowSchema>;

export type ReconciliationStatus =
  | "matched"
  | "amount_mismatch"
  | "charge_mismatch"
  | "missing_in_invoice"
  | "extra_in_invoice"
  | "tracking_mismatch";

export interface ReconciledRow {
  shipmentId: string;
  orderId: string | null;
  provider: string | null;
  status: ReconciliationStatus;
  disputed: boolean;
  disputeReasons: string[];
  /** Our numbers — always the originals, never adjusted to the invoice. */
  expectedPayablePoisha: number | null;
  invoicedPayablePoisha: number | null;
  /** invoiced − expected (payable), null when one side is missing. */
  differencePoisha: number | null;
}

export interface ReconciliationSummary {
  expectedTotalPoisha: number;
  invoicedTotalPoisha: number;
  /** Money both sides agree on — safe to pay. */
  matchedTotalPoisha: number;
  /** Money in dispute — held back, never auto-adjusted. */
  disputedTotalPoisha: number;
  matchedCount: number;
  disputedCount: number;
  missingCount: number;
  extraCount: number;
}

export interface CourierReconciliation {
  rows: ReconciledRow[];
  summary: ReconciliationSummary;
}

function expectedPayable(s: ExpectedShipment): number {
  return s.codCollectedPoisha - s.deliveryChargePoisha - s.codFeePoisha - s.returnChargePoisha;
}

function invoicedPayable(r: CourierInvoiceRow): number {
  return (
    r.invoicedPayablePoisha ??
    r.codCollectedPoisha - r.deliveryChargePoisha - r.codFeePoisha - r.returnChargePoisha
  );
}

function reconcilePair(expected: ExpectedShipment, invoice: CourierInvoiceRow): ReconciledRow {
  const reasons: string[] = [];
  let status: ReconciliationStatus = "matched";
  if (expected.trackingId && invoice.trackingId && expected.trackingId !== invoice.trackingId) {
    status = "tracking_mismatch";
    reasons.push(`tracking_id_differs:${expected.trackingId}!=${invoice.trackingId}`);
  } else if (expected.codCollectedPoisha !== invoice.codCollectedPoisha) {
    status = "amount_mismatch";
    reasons.push(
      `cod_collected_differs:expected_${expected.codCollectedPoisha}!=invoice_${invoice.codCollectedPoisha}`,
    );
  } else if (
    expected.deliveryChargePoisha !== invoice.deliveryChargePoisha ||
    expected.codFeePoisha !== invoice.codFeePoisha ||
    expected.returnChargePoisha !== invoice.returnChargePoisha
  ) {
    status = "charge_mismatch";
    reasons.push("a_charge_differs:delivery/cod_fee/return — see expected vs invoice row values");
  }
  const exp = expectedPayable(expected);
  const inv = invoicedPayable(invoice);
  if (status === "matched" && exp !== inv) {
    status = "charge_mismatch";
    reasons.push(`payable_differs:expected_${exp}!=invoice_${inv}`);
  }
  return {
    shipmentId: expected.shipmentId,
    orderId: expected.orderId,
    provider: expected.provider,
    status,
    disputed: status !== "matched",
    disputeReasons: reasons,
    expectedPayablePoisha: exp,
    invoicedPayablePoisha: inv,
    differencePoisha: inv - exp,
  };
}

export function reconcileCourierInvoice(
  expectedRaw: readonly unknown[],
  invoiceRaw: readonly unknown[],
): CourierReconciliation {
  const expected = expectedRaw.map((r) => expectedShipmentSchema.parse(r));
  const invoice = invoiceRaw.map((r) => courierInvoiceRowSchema.parse(r));

  const invoiceById = new Map<string, CourierInvoiceRow>();
  for (const row of invoice) invoiceById.set(row.shipmentId, row);
  const expectedIds = new Set(expected.map((s) => s.shipmentId));

  const rows: ReconciledRow[] = [];
  for (const exp of expected) {
    const inv = invoiceById.get(exp.shipmentId);
    if (!inv) {
      rows.push({
        shipmentId: exp.shipmentId,
        orderId: exp.orderId,
        provider: exp.provider,
        status: "missing_in_invoice",
        disputed: true,
        disputeReasons: ["shipment_not_billed_by_courier"],
        expectedPayablePoisha: expectedPayable(exp),
        invoicedPayablePoisha: null,
        differencePoisha: null,
      });
    } else {
      rows.push(reconcilePair(exp, inv));
    }
  }
  for (const inv of invoice) {
    if (expectedIds.has(inv.shipmentId)) continue;
    rows.push({
      shipmentId: inv.shipmentId,
      orderId: null,
      provider: null,
      status: "extra_in_invoice",
      disputed: true,
      disputeReasons: ["courier_billed_unknown_shipment"],
      expectedPayablePoisha: null,
      invoicedPayablePoisha: invoicedPayable(inv),
      differencePoisha: null,
    });
  }

  let matchedTotalPoisha = 0;
  let disputedTotalPoisha = 0;
  for (const row of rows) {
    if (row.status === "matched" && row.expectedPayablePoisha !== null) {
      matchedTotalPoisha += row.expectedPayablePoisha;
    }
    if (row.disputed) {
      // Disputed exposure is measured on OUR expected payable when we have
      // one (that is the money at risk), otherwise on the invoiced amount
      // the courier is claiming for an unknown shipment.
      disputedTotalPoisha += row.expectedPayablePoisha ?? row.invoicedPayablePoisha ?? 0;
    }
  }

  return {
    rows,
    summary: {
      expectedTotalPoisha: expected.reduce((s, e) => s + expectedPayable(e), 0),
      invoicedTotalPoisha: invoice.reduce((s, r) => s + invoicedPayable(r), 0),
      matchedTotalPoisha,
      disputedTotalPoisha,
      matchedCount: rows.filter((r) => r.status === "matched").length,
      disputedCount: rows.filter((r) => r.disputed).length,
      missingCount: rows.filter((r) => r.status === "missing_in_invoice").length,
      extraCount: rows.filter((r) => r.status === "extra_in_invoice").length,
    },
  };
}

export const reconcileRequestSchema = z.object({
  expected: z.array(expectedShipmentSchema).min(1),
  invoice: z.array(courierInvoiceRowSchema),
});
