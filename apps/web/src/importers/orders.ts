// WooCommerce / Shopify ORDER exports -> order groups (ADV-25).
//
// Both exports are row-per-item: the mapper groups rows back into
// orders (by source order id; by phone when the file has no order-id
// column at all). Groups are then validated and, on confirm, created
// through createManualOrder — the same pipeline as the native CSV
// order import: prices come from the CATALOG, never from the file,
// and shipping is computed by the shared engine from the district.
//
// The platform's hard rule drives the headline behaviour: an order
// needs a BD phone number. Source rows without one are SKIPPED with
// the reason recorded — a phone is never invented.
//
// Address honesty: neither export has BD division/district/upazila.
// The mapping used is the one BD stores themselves use in these
// systems — State/Province -> division, City -> district — and
// upazila, which the source simply does not carry, is set to the
// city value and FLAGGED in the report + per-order outcomes so staff
// verify it. The full original address is preserved verbatim in
// addressLine, so nothing the customer wrote is lost.

import { normalizeBdPhone } from "@/checkout/validation";
import { normalizeTable, pick, splitColumns, type NormalizedTable } from "./common";
import type { MappingEntry, OrderSourceId } from "./types";

export interface MappedOrderItem {
  sku: string;
  itemName: string;
  quantity: number;
  sourceRow: number;
}

export interface MappedOrderGroup {
  sourceOrderId: string;
  sourceRows: number[];
  customerName: string;
  phoneRaw: string;
  division: string;
  district: string;
  upazila: string;
  addressLine: string;
  paymentMethodRaw: string;
  paymentMethod: "cod" | "bkash" | "nagad";
  /** Set when an unrecognised payment method fell back to cod. */
  paymentMethodNote: string | null;
  /** Currency recorded on the source order ("" when the file has none). */
  currency: string;
  statusRaw: string;
  dateRaw: string;
  customerNote: string;
  items: MappedOrderItem[];
  /** Mapper-level problems that make the group unimportable. */
  mapperIssues: string[];
}

export interface OrderMapResult {
  groups: MappedOrderGroup[];
  unmappedColumns: string[];
  consumedColumns: string[];
  notes: string[];
  totalSourceRows: number;
}

export interface OrderGroupVerdict {
  sourceOrderId: string;
  sourceRows: number[];
  status: "ready" | "skipped";
  /** Blocking problems — the order is skipped for these. */
  reasons: string[];
  /** Non-blocking flags (e.g. payment-method fallback) — the order
   *  still imports, and the flag is also written to its internal note. */
  warnings: string[];
  itemCount: number;
  currency: string;
}

export interface OrderImportReport {
  source: OrderSourceId;
  kind: "orders";
  fileName: string | null;
  totalSourceRows: number;
  orderCount: number;
  readyCount: number;
  skippedCount: number;
  orders: OrderGroupVerdict[];
  unmappedColumns: string[];
  consumedColumns: string[];
  notes: string[];
  mapping: MappingEntry[];
}

export const WOO_ORDER_MAPPING: MappingEntry[] = [
  { source: "Order ID", target: "(grouping + order note)", note: "Rows sharing an Order ID form one order. The id is recorded on the created order's internal note." },
  { source: "Billing Phone", target: "phone", note: "Mandatory: orders without a valid BD phone are skipped with the reason recorded." },
  { source: "Billing First/Last Name", target: "customerName" },
  { source: "Billing State", target: "division", note: "BD WooCommerce stores record the division in State." },
  { source: "Billing City", target: "district" },
  { source: "— (no upazila in source)", target: "upazila", note: "Set to the Billing City value and flagged for staff verification — the source does not carry an upazila." },
  { source: "Billing Address 1/2 + City + State + Postcode", target: "addressLine", note: "The full original address, preserved verbatim." },
  { source: "Item SKU", target: "items[].sku", note: "Prices are the platform's catalog prices, never the file's." },
  { source: "Item Quantity", target: "items[].quantity" },
  { source: "Payment Method", target: "paymentMethod", note: "bkash / nagad recognised by name; cod/cash -> cod; anything else falls back to cod and is flagged per order." },
  { source: "Order Status / Order Date", target: "(order note only)", note: "Imported orders are created as new PENDING orders; the source status + date are recorded on the internal note, not faked into history." },
  { source: "Currency", target: "(report only)", note: "Source totals are never used (prices are catalog prices), so no conversion is applied; the currency is recorded here." },
  { source: "Customer Note", target: "note" },
];

export const SHOPIFY_ORDER_MAPPING: MappingEntry[] = [
  { source: "Name (#1001)", target: "(grouping + order note)", note: "Rows sharing an order Name form one order; the leading # is stripped." },
  { source: "Billing Phone / Shipping Phone", target: "phone", note: "Billing first, Shipping as fallback. Mandatory: orders without a valid BD phone are skipped with the reason recorded." },
  { source: "Billing Name", target: "customerName", note: "Falls back to Shipping Name." },
  { source: "Billing Province", target: "division" },
  { source: "Billing City", target: "district" },
  { source: "— (no upazila in source)", target: "upazila", note: "Set to the Billing City value and flagged for staff verification — the source does not carry an upazila." },
  { source: "Billing Address1/2 + City + Province + Zip", target: "addressLine", note: "The full original address, preserved verbatim." },
  { source: "Lineitem SKU", target: "items[].sku", note: "Prices are the platform's catalog prices, never the file's." },
  { source: "Lineitem Quantity", target: "items[].quantity" },
  { source: "Payment Method", target: "paymentMethod", note: "bkash / nagad recognised by name; cod/cash -> cod; anything else falls back to cod and is flagged per order." },
  { source: "Financial Status / Created at", target: "(order note only)", note: "Imported orders are created as new PENDING orders; the source status + date are recorded on the internal note." },
  { source: "Currency", target: "(report only)", note: "Source totals are never used (prices are catalog prices), so no conversion is applied; the currency is recorded here." },
  { source: "Cancelled at", target: "(skip rule)", note: "Orders cancelled in Shopify are skipped with the reason recorded." },
  { source: "Notes", target: "note" },
];

function mapPaymentMethod(raw: string): {
  method: "cod" | "bkash" | "nagad";
  note: string | null;
} {
  const v = raw.trim().toLowerCase();
  if (v === "") return { method: "cod", note: null };
  if (v.includes("bkash")) return { method: "bkash", note: null };
  if (v.includes("nagad")) return { method: "nagad", note: null };
  if (v.includes("cod") || v.includes("cash")) return { method: "cod", note: null };
  return {
    method: "cod",
    note: `Payment method "${raw}" is not cod/bkash/nagad — imported as cod. Verify with the customer.`,
  };
}

/** "SKU:qty; SKU2:qty2" combined-items cell fallback (some exports). */
function parseCombinedItems(cell: string, sourceRow: number, items: MappedOrderItem[]): boolean {
  let parsedAny = false;
  for (const part of cell.split(";")) {
    const match = /^\s*(.+?)\s*(?:[:x*]\s*|\s+)(\d+)\s*$/.exec(part);
    if (!match) continue;
    items.push({
      sku: (match[1] as string).trim(),
      itemName: "",
      quantity: Number(match[2]),
      sourceRow,
    });
    parsedAny = true;
  }
  return parsedAny;
}

interface RawOrderRow {
  sourceRow: number;
  orderId: string;
  statusRaw: string;
  dateRaw: string;
  name: string;
  phone: string;
  division: string;
  city: string;
  addressParts: string[];
  paymentRaw: string;
  currency: string;
  note: string;
  sku: string;
  itemName: string;
  qtyRaw: string;
  combinedItems: string;
  extraIssues: string[];
}

function groupRawRows(rawRows: RawOrderRow[]): MappedOrderGroup[] {
  const groups = new Map<string, MappedOrderGroup & { itemKeys: Map<string, number> }>();
  for (const raw of rawRows) {
    const key =
      raw.orderId !== ""
        ? `id:${raw.orderId}`
        : `noid:${normalizeBdPhone(raw.phone) ?? raw.phone}`;
    let group = groups.get(key);
    if (!group) {
      const payment = mapPaymentMethod(raw.paymentRaw);
      group = {
        sourceOrderId: raw.orderId !== "" ? raw.orderId : `(no order id — grouped by phone)`,
        sourceRows: [],
        customerName: raw.name,
        phoneRaw: raw.phone,
        division: raw.division,
        district: raw.city,
        upazila: raw.city,
        addressLine: raw.addressParts.filter((p) => p !== "").join(", "),
        paymentMethodRaw: raw.paymentRaw,
        paymentMethod: payment.method,
        paymentMethodNote: payment.note,
        currency: raw.currency,
        statusRaw: raw.statusRaw,
        dateRaw: raw.dateRaw,
        customerNote: raw.note,
        items: [],
        mapperIssues: [],
        itemKeys: new Map(),
      };
      groups.set(key, group);
    }
    group.sourceRows.push(raw.sourceRow);
    for (const issue of raw.extraIssues) {
      if (!group.mapperIssues.includes(issue)) group.mapperIssues.push(issue);
    }
    const addItem = (sku: string, itemName: string, qty: number) => {
      const existing = group.itemKeys.get(sku);
      if (existing !== undefined) {
        const item = group.items[existing] as MappedOrderItem;
        item.quantity += qty;
      } else {
        group.itemKeys.set(sku, group.items.length);
        group.items.push({ sku, itemName, quantity: qty, sourceRow: raw.sourceRow });
      }
    };
    if (raw.sku !== "") {
      const qty = Number(raw.qtyRaw);
      if (!Number.isInteger(qty) || qty <= 0) {
        const issue = `Invalid quantity "${raw.qtyRaw}" for SKU ${raw.sku} (row ${raw.sourceRow}).`;
        if (!group.mapperIssues.includes(issue)) group.mapperIssues.push(issue);
      } else {
        addItem(raw.sku, raw.itemName, qty);
      }
    } else if (raw.combinedItems !== "") {
      const items: MappedOrderItem[] = [];
      if (parseCombinedItems(raw.combinedItems, raw.sourceRow, items)) {
        for (const item of items) addItem(item.sku, item.itemName, item.quantity);
      }
    }
  }
  return [...groups.values()].map(({ itemKeys: _itemKeys, ...group }) => group);
}

const WOO_ORDER_CONSUMED = new Set([
  "order_id",
  "order_number",
  "id",
  "order_status",
  "status",
  "order_date",
  "date_created",
  "billing_first_name",
  "billing_last_name",
  "billing_name",
  "customer_name",
  "shipping_first_name",
  "shipping_last_name",
  "shipping_name",
  "billing_phone",
  "phone",
  "customer_phone",
  "shipping_phone",
  "billing_state",
  "billing_city",
  "billing_address_1",
  "billing_address",
  "billing_address_2",
  "billing_postcode",
  "billing_zip",
  "billing_country",
  "item_sku",
  "product_sku",
  "sku",
  "lineitem_sku",
  "item_quantity",
  "quantity",
  "qty",
  "lineitem_quantity",
  "item_name",
  "product_name",
  "payment_method",
  "payment_method_title",
  "payment_gateway",
  "currency",
  "order_currency",
  "customer_note",
  "note",
  "items",
  "order_items",
]);

export function mapWoocommerceOrders(table: NormalizedTable): OrderMapResult {
  const rawRows: RawOrderRow[] = table.rows.map((row, idx) => {
    const firstName = pick(row, ["billing_first_name"]);
    const lastName = pick(row, ["billing_last_name"]);
    const shipFirst = pick(row, ["shipping_first_name"]);
    const shipLast = pick(row, ["shipping_last_name"]);
    const name =
      [firstName, lastName].filter(Boolean).join(" ") ||
      pick(row, ["billing_name", "customer_name"]) ||
      [shipFirst, shipLast].filter(Boolean).join(" ") ||
      pick(row, ["shipping_name"]);
    return {
      sourceRow: idx + 2,
      orderId: pick(row, ["order_id", "order_number", "id"]),
      statusRaw: pick(row, ["order_status", "status"]),
      dateRaw: pick(row, ["order_date", "date_created"]),
      name,
      phone: pick(row, ["billing_phone", "phone", "customer_phone", "shipping_phone"]),
      division: pick(row, ["billing_state"]),
      city: pick(row, ["billing_city"]),
      addressParts: [
        pick(row, ["billing_address_1", "billing_address"]),
        pick(row, ["billing_address_2"]),
        pick(row, ["billing_city"]),
        pick(row, ["billing_state"]),
        pick(row, ["billing_postcode", "billing_zip"]),
        pick(row, ["billing_country"]),
      ],
      paymentRaw: pick(row, ["payment_method", "payment_method_title", "payment_gateway"]),
      currency: pick(row, ["currency", "order_currency"]),
      note: pick(row, ["customer_note", "note"]),
      sku: pick(row, ["item_sku", "product_sku", "sku", "lineitem_sku"]),
      itemName: pick(row, ["item_name", "product_name"]),
      qtyRaw: pick(row, ["item_quantity", "quantity", "qty", "lineitem_quantity"]) || "1",
      combinedItems: pick(row, ["items", "order_items"]),
      extraIssues: [],
    };
  });
  const hasOrderIdColumn = table.originalHeaders.some((h) =>
    ["order_id", "order_number", "id"].includes(h.toLowerCase().replace(/[^a-z0-9]+/g, "_")),
  );
  const groups = groupRawRows(rawRows);
  const { consumedColumns, unmappedColumns } = splitColumns(table.originalHeaders, WOO_ORDER_CONSUMED);
  return {
    groups,
    unmappedColumns,
    consumedColumns,
    totalSourceRows: table.rows.length,
    notes: [
      "Upazila is not present in WooCommerce exports: it is set to the Billing City value on every imported order — staff should verify it. The full original address is preserved in the address line.",
      ...(hasOrderIdColumn
        ? []
        : ["The file has no order-id column, so rows were grouped by customer phone (the native import's grouping)."]),
    ],
  };
}

const SHOPIFY_ORDER_CONSUMED = new Set([
  "name",
  "id",
  "financial_status",
  "fulfillment_status",
  "cancelled_at",
  "created_at",
  "billing_name",
  "shipping_name",
  "billing_phone",
  "shipping_phone",
  "phone",
  "billing_province",
  "billing_city",
  "billing_address1",
  "billing_address2",
  "billing_zip",
  "billing_country",
  "lineitem_sku",
  "lineitem_quantity",
  "lineitem_name",
  "payment_method",
  "currency",
  "notes",
  "note_attributes",
]);

export function mapShopifyOrders(table: NormalizedTable): OrderMapResult {
  const rawRows: RawOrderRow[] = table.rows.map((row, idx) => {
    const cancelledAt = pick(row, ["cancelled_at"]);
    return {
      sourceRow: idx + 2,
      orderId: pick(row, ["name", "order_name", "id"]).replace(/^#/, ""),
      statusRaw: pick(row, ["financial_status", "fulfillment_status"]),
      dateRaw: pick(row, ["created_at"]),
      name: pick(row, ["billing_name"]) || pick(row, ["shipping_name"]),
      phone: pick(row, ["billing_phone", "shipping_phone", "phone"]),
      division: pick(row, ["billing_province"]),
      city: pick(row, ["billing_city"]),
      addressParts: [
        pick(row, ["billing_address1"]),
        pick(row, ["billing_address2"]),
        pick(row, ["billing_city"]),
        pick(row, ["billing_province"]),
        pick(row, ["billing_zip"]),
        pick(row, ["billing_country"]),
      ],
      paymentRaw: pick(row, ["payment_method"]),
      currency: pick(row, ["currency"]),
      note: pick(row, ["notes", "note_attributes"]),
      sku: pick(row, ["lineitem_sku"]),
      itemName: pick(row, ["lineitem_name"]),
      qtyRaw: pick(row, ["lineitem_quantity"]) || "1",
      combinedItems: "",
      extraIssues:
        cancelledAt !== ""
          ? [`Order was cancelled in Shopify (Cancelled at: ${cancelledAt}) — skipped.`]
          : [],
    };
  });
  const groups = groupRawRows(rawRows);
  const { consumedColumns, unmappedColumns } = splitColumns(table.originalHeaders, SHOPIFY_ORDER_CONSUMED);
  return {
    groups,
    unmappedColumns,
    consumedColumns,
    totalSourceRows: table.rows.length,
    notes: [
      "Upazila is not present in Shopify exports: it is set to the Billing City value on every imported order — staff should verify it. The full original address is preserved in the address line.",
    ],
  };
}

export const ORDER_MAPPINGS: Record<OrderSourceId, MappingEntry[]> = {
  woocommerce: WOO_ORDER_MAPPING,
  shopify: SHOPIFY_ORDER_MAPPING,
};

export const ORDER_MAPPERS: Record<OrderSourceId, (table: NormalizedTable) => OrderMapResult> = {
  woocommerce: mapWoocommerceOrders,
  shopify: mapShopifyOrders,
};

/**
 * Validate mapped groups against the live catalog (SKU resolution is
 * the caller's job — variantBySku comes from the DB). Pure and
 * shared by the dry run and the confirm path so both judge identically.
 */
export function validateOrderGroups(
  groups: MappedOrderGroup[],
  variantBySku: Map<string, { id: string; pricePoisha: number }>,
): OrderGroupVerdict[] {
  return groups.map((group) => {
    const reasons: string[] = [...group.mapperIssues];
    if (group.phoneRaw.trim() === "") {
      reasons.push("No phone number in the source order — a BD phone is mandatory in this platform, so the order is skipped (a phone is never invented).");
    } else if (normalizeBdPhone(group.phoneRaw) === null) {
      reasons.push(`Phone "${group.phoneRaw}" is not a valid BD mobile number — skipped.`);
    }
    if (group.customerName.trim().length < 2) {
      reasons.push("Customer name is missing or too short — skipped.");
    }
    if (group.division.trim() === "") reasons.push("Division (source State/Province) is empty — skipped.");
    if (group.district.trim() === "") reasons.push("District (source City) is empty — skipped.");
    if (group.addressLine.trim().length < 5) reasons.push("Address line is empty or too short — skipped.");
    if (group.items.length === 0 && reasons.length === 0) {
      reasons.push("No items could be read from the source rows — skipped.");
    }
    const unknown = group.items.filter((item) => !variantBySku.has(item.sku));
    for (const item of unknown) {
      reasons.push(
        `Unknown SKU "${item.sku}"${item.itemName ? ` (${item.itemName})` : ""} — import the product first or fix the SKU. Whole order skipped so no partial order is created.`,
      );
    }
    return {
      sourceOrderId: group.sourceOrderId,
      sourceRows: group.sourceRows,
      status: reasons.length === 0 ? "ready" : "skipped",
      reasons,
      warnings: group.paymentMethodNote ? [group.paymentMethodNote] : [],
      itemCount: group.items.length,
      currency: group.currency,
    };
  });
}
