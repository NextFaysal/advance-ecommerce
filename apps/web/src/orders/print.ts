// Print outline — invoice, packing slip, delivery challan, courier label.
// Formats: A4 (invoice/challan) and thermal 58mm / 80mm (label/sticker).
// This module builds PRINT DATA only. Actual rendering is a print stylesheet /
// print view in the admin detail page; thermal-printer (Bluetooth) integration
// from a phone is a v2/device follow-up, not implemented here.
import type { Order } from "./types";
import { formatBdt } from "../checkout/pricing";
import { lineTotalPoisha, qtyToString } from "../lib/quantity";

export type PrintFormat = "A4" | "THERMAL_58" | "THERMAL_80";

export type PrintDocument =
  | "invoice"
  | "packing_slip"
  | "delivery_challan"
  | "courier_label";

export type PrintData = {
  document: PrintDocument;
  format: PrintFormat;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  addressText: string;
  itemsText: string[];
  totalText: string;
  courier?: string;
  trackingId?: string;
  barcodeValue: string;
};

export function buildPrintData(
  order: Order,
  document: PrintDocument,
  format: PrintFormat,
  customerPhoneMasked: string,
): PrintData {
  const a = order.address;
  return {
    document,
    format,
    orderNo: order.orderNo,
    customerName: order.customerName,
    customerPhoneMasked,
    addressText: [
      a.addressLine,
      a.union,
      a.upazila,
      a.district,
      a.division,
    ]
      .filter(Boolean)
      .join(", "),
    itemsText: order.items.map(
      (i) => `${i.productName} (${i.sku}) x${qtyToString(i.quantity)} — ${formatBdt(lineTotalPoisha(i.unitPricePoisha, i.quantity))}`,
    ),
    totalText: formatBdt(order.totalPoisha),
    courier: order.courier,
    trackingId: order.trackingId,
    barcodeValue: order.trackingId ?? order.orderNo,
  };
}
