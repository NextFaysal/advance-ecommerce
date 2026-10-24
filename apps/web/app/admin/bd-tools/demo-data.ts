/**
 * BD Tools admin page — TEMPORARY DEMO inputs (Agent 41).
 *
 * These rows are SAMPLE data only. They are fed through the REAL pure
 * computations in src/bd/cash-closing.ts (buildDailyCashClosing) and
 * src/bd/courier-reconciliation.ts (reconcileCourierInvoice) by the
 * server page — nothing is pre-computed or hand-faked here.
 *
 * Cash closing sample = the documented test case in cash-closing.ts:
 * drawer cash matches exactly (150000), bKash is short by 1000 poisha,
 * Nagad and courier COD match -> hasMismatch true, channels ["bkash"].
 *
 * Reconciliation sample covers: 1 matched, 1 charge_mismatch (delivery
 * charge 6000 -> 7000 on the invoice, our expected payable stays
 * 142500), 1 amount_mismatch (COD 80000 vs 75000), 1
 * missing_in_invoice, 1 extra_in_invoice (unknown shipment).
 */
import type { DailyCashClosingInput } from "@/bd/cash-closing";
import type { CourierInvoiceRow, ExpectedShipment } from "@/bd/courier-reconciliation";

export const DEMO_CASH_CLOSING_DATE = "2026-10-24";

export const DEMO_CASH_CLOSING_INPUT: DailyCashClosingInput = {
  date: DEMO_CASH_CLOSING_DATE,
  openingCashPoisha: 100000,
  cashSalesPoisha: 500000,
  cashRefundsPoisha: 20000,
  expensesPoisha: 30000,
  cashDepositedPoisha: 400000,
  countedCashPoisha: 150000,
  bkash: { expectedPoisha: 250000, actualPoisha: 249000 },
  nagad: { expectedPoisha: 120000, actualPoisha: 120000 },
  courierCodReceivable: { expectedPoisha: 800000, actualPoisha: 800000 },
  customerDuePoisha: 45000,
  tolerancePoisha: 0,
};

export const DEMO_EXPECTED_SHIPMENTS: readonly ExpectedShipment[] = [
  {
    shipmentId: "SHP-1001",
    orderId: "ORD-100501",
    trackingId: "STF1001",
    provider: "Steadfast",
    codCollectedPoisha: 100000,
    deliveryChargePoisha: 6000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
  {
    shipmentId: "SHP-1002",
    orderId: "ORD-100502",
    trackingId: "PTH2002",
    provider: "Pathao",
    codCollectedPoisha: 150000,
    deliveryChargePoisha: 6000,
    codFeePoisha: 1500,
    returnChargePoisha: 0,
  },
  {
    shipmentId: "SHP-1003",
    orderId: "ORD-100503",
    trackingId: "RDX3003",
    provider: "RedX",
    codCollectedPoisha: 80000,
    deliveryChargePoisha: 12000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
  {
    shipmentId: "SHP-1004",
    orderId: "ORD-100504",
    trackingId: "STF1004",
    provider: "Steadfast",
    codCollectedPoisha: 50000,
    deliveryChargePoisha: 6000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
];

export const DEMO_INVOICE_ROWS: readonly CourierInvoiceRow[] = [
  {
    shipmentId: "SHP-1001",
    trackingId: "STF1001",
    codCollectedPoisha: 100000,
    deliveryChargePoisha: 6000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
  {
    shipmentId: "SHP-1002",
    trackingId: "PTH2002",
    codCollectedPoisha: 150000,
    deliveryChargePoisha: 7000,
    codFeePoisha: 1500,
    returnChargePoisha: 0,
    invoicedPayablePoisha: 141500,
  },
  {
    shipmentId: "SHP-1003",
    trackingId: "RDX3003",
    codCollectedPoisha: 75000,
    deliveryChargePoisha: 12000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
  {
    shipmentId: "SHP-9999",
    codCollectedPoisha: 30000,
    deliveryChargePoisha: 6000,
    codFeePoisha: 0,
    returnChargePoisha: 0,
  },
];
