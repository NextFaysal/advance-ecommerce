/**
 * Custom report builder — ADV-8 (doc 22). Basic but real: pick a
 * dataset, pick columns, apply filters, choose a Dhaka date range →
 * preview rows + watermarked CSV export under the SAME contract as
 * the sales export (reason mandatory, watermark header, audit log —
 * see app/api/v1/admin/reports/export/route.ts).
 *
 * Everything here is pure over SalesRow[] (the reports row shape);
 * routes fetch rows via fetchSalesRows and hand them in. Money is
 * integer poisha end to end. Datasets aggregate the item-level rows:
 *   orders    — one row per order
 *   products  — one row per product
 *   customers — one row per customer
 * Filters (status / district / courier) apply to the underlying
 * sales rows BEFORE aggregation, so a products report filtered to
 * district=Dhaka shows Dhaka-only product sales — labelled as such in
 * the export watermark (filters are printed there).
 */
import { z } from "zod";
import { dateRangeSchema, type DateRange, type SalesRow } from "./types";
import { addQty } from "../lib/quantity";
import type { Locale } from "../i18n/locale";

export const REPORT_DATASETS = ["orders", "products", "customers"] as const;
export type ReportDataset = (typeof REPORT_DATASETS)[number];

export type ReportColumnType = "text" | "int" | "money";
export interface ReportColumn {
  key: string;
  label: string;
  type: ReportColumnType;
}

export const REPORT_COLUMNS: Record<ReportDataset, ReportColumn[]> = {
  orders: [
    { key: "orderId", label: "Order ID", type: "text" },
    { key: "date", label: "Date (Dhaka)", type: "text" },
    { key: "status", label: "Status", type: "text" },
    { key: "customerId", label: "Customer ID", type: "text" },
    { key: "district", label: "District", type: "text" },
    { key: "courier", label: "Courier", type: "text" },
    { key: "units", label: "Units", type: "int" },
    { key: "revenuePoisha", label: "Revenue (poisha)", type: "money" },
    { key: "costPoisha", label: "Cost (poisha)", type: "money" },
    { key: "shippingPoisha", label: "Shipping (poisha)", type: "money" },
    { key: "refundPoisha", label: "Refund (poisha)", type: "money" },
    { key: "grossProfitPoisha", label: "Gross profit (poisha)", type: "money" },
    { key: "netRevenuePoisha", label: "Net revenue (poisha)", type: "money" },
  ],
  products: [
    { key: "productId", label: "Product ID", type: "text" },
    { key: "orders", label: "Orders", type: "int" },
    { key: "units", label: "Units sold", type: "int" },
    { key: "revenuePoisha", label: "Revenue (poisha)", type: "money" },
    { key: "costPoisha", label: "Cost (poisha)", type: "money" },
    { key: "refundPoisha", label: "Refund (poisha)", type: "money" },
    { key: "grossProfitPoisha", label: "Gross profit (poisha)", type: "money" },
  ],
  customers: [
    { key: "customerId", label: "Customer ID", type: "text" },
    { key: "orders", label: "Orders", type: "int" },
    { key: "units", label: "Units", type: "int" },
    { key: "revenuePoisha", label: "Revenue (poisha)", type: "money" },
    { key: "refundPoisha", label: "Refund (poisha)", type: "money" },
    { key: "netRevenuePoisha", label: "Net revenue (poisha)", type: "money" },
    { key: "firstOrderDate", label: "First order (Dhaka)", type: "text" },
    { key: "lastOrderDate", label: "Last order (Dhaka)", type: "text" },
  ],
};

/**
 * Doc 30: column labels are display copy. REPORT_COLUMNS above stays
 * the key/type source with the EN label; the bn label set lives here,
 * keyed by dataset + column key. Data values and column KEYS never
 * localize (the CSV header prints keys — the export contract).
 */
export const REPORT_COLUMN_LABELS_BN: Record<ReportDataset, Record<string, string>> = {
  orders: {
    orderId: "অর্ডার আইডি",
    date: "তারিখ (ঢাকা)",
    status: "অবস্থা",
    customerId: "গ্রাহক আইডি",
    district: "জেলা",
    courier: "কুরিয়ার",
    units: "পরিমাণ (ইউনিট)",
    revenuePoisha: "আয় (পয়সা)",
    costPoisha: "খরচ (পয়সা)",
    shippingPoisha: "ডেলিভারি চার্জ (পয়সা)",
    refundPoisha: "ফেরত (পয়সা)",
    grossProfitPoisha: "মোট লাভ (পয়সা)",
    netRevenuePoisha: "নিট আয় (পয়সা)",
  },
  products: {
    productId: "পণ্য আইডি",
    orders: "অর্ডার",
    units: "বিক্রিত পরিমাণ",
    revenuePoisha: "আয় (পয়সা)",
    costPoisha: "খরচ (পয়সা)",
    refundPoisha: "ফেরত (পয়সা)",
    grossProfitPoisha: "মোট লাভ (পয়সা)",
  },
  customers: {
    customerId: "গ্রাহক আইডি",
    orders: "অর্ডার",
    units: "পরিমাণ (ইউনিট)",
    revenuePoisha: "আয় (পয়সা)",
    refundPoisha: "ফেরত (পয়সা)",
    netRevenuePoisha: "নিট আয় (পয়সা)",
    firstOrderDate: "প্রথম অর্ডার (ঢাকা)",
    lastOrderDate: "সর্বশেষ অর্ডার (ঢাকা)",
  },
};

/** The dataset catalogue with labels picked for `locale`
 *  (bn falls back to the EN label for any key without a bn entry). */
export function reportColumnsFor(dataset: ReportDataset, locale: Locale): ReportColumn[] {
  return REPORT_COLUMNS[dataset].map((c) => ({
    ...c,
    label: locale === "bn" ? (REPORT_COLUMN_LABELS_BN[dataset][c.key] ?? c.label) : c.label,
  }));
}

export const reportFiltersSchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  district: z.string().trim().min(1).max(80).optional(),
  courier: z.string().trim().min(1).max(80).optional(),
});
export type ReportFilters = z.infer<typeof reportFiltersSchema>;

export const reportDefinitionSchema = z.object({
  dataset: z.enum(REPORT_DATASETS),
  columns: z.array(z.string().min(1).max(40)).min(1).max(20),
  filters: reportFiltersSchema.default({}),
  range: dateRangeSchema,
});
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

/** Validate the definition AND that every column exists in the
 *  dataset's catalogue (the zod schema alone can't know the catalogue). */
export function validateReportDefinition(input: unknown):
  | { ok: true; definition: ReportDefinition }
  | { ok: false; message: string } {
  const parsed = reportDefinitionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join("; ") };
  const allowed = new Set(REPORT_COLUMNS[parsed.data.dataset].map((c) => c.key));
  const bad = parsed.data.columns.filter((c) => !allowed.has(c));
  if (bad.length > 0) return { ok: false, message: `Unknown columns for ${parsed.data.dataset}: ${bad.join(", ")}` };
  return { ok: true, definition: parsed.data };
}

type Row = Record<string, string | number>;

function baseAgg() {
  return { orders: new Set<string>(), units: 0, revenuePoisha: 0, costPoisha: 0, shippingPoisha: 0, refundPoisha: 0 };
}
type Agg = ReturnType<typeof baseAgg>;

function addToAgg(a: Agg, r: SalesRow): void {
  a.orders.add(r.orderId);
  a.units = addQty(a.units, r.quantity);
  a.revenuePoisha += r.revenuePoisha;
  a.costPoisha += r.costPoisha;
  a.shippingPoisha += r.shippingPoisha;
  a.refundPoisha += r.refundPoisha;
}

function moneyFields(a: Agg): Row {
  return {
    orders: a.orders.size,
    units: a.units,
    revenuePoisha: a.revenuePoisha,
    costPoisha: a.costPoisha,
    shippingPoisha: a.shippingPoisha,
    refundPoisha: a.refundPoisha,
    grossProfitPoisha: a.revenuePoisha - a.costPoisha,
    netRevenuePoisha: a.revenuePoisha - a.refundPoisha,
  };
}

export interface BuiltReport {
  dataset: ReportDataset;
  columns: ReportColumn[];
  /** Full result rows (routes cap the preview, never the export). */
  rows: Row[];
}

/**
 * Build the report. `locale` localizes the returned column LABELS
 * only (data + keys are locale-free). It defaults to "en" — the
 * historical catalogue labels — so callers that cannot resolve a
 * locale keep today's output; request handlers pass the request
 * locale and the scheduled-email path passes the job's locale.
 */
export function buildReport(
  definition: ReportDefinition,
  salesRows: readonly SalesRow[],
  locale: Locale = "en",
): BuiltReport {
  const { dataset, range, filters } = definition;
  const filtered = salesRows.filter((r) => {
    if (r.date < range.from || r.date > range.to) return false;
    if (filters.status !== undefined && r.status !== filters.status) return false;
    if (filters.district !== undefined && r.district !== filters.district) return false;
    if (filters.courier !== undefined && (r.courier ?? "") !== filters.courier) return false;
    return true;
  });

  let all: Row[];
  if (dataset === "orders") {
    const byOrder = new Map<string, { first: SalesRow; agg: Agg }>();
    for (const r of filtered) {
      const e = byOrder.get(r.orderId) ?? { first: r, agg: baseAgg() };
      addToAgg(e.agg, r);
      byOrder.set(r.orderId, e);
    }
    all = Array.from(byOrder.values()).map(({ first, agg }) => ({
      orderId: first.orderId,
      date: first.date,
      status: first.status,
      customerId: first.customerId,
      district: first.district,
      courier: first.courier ?? "",
      ...moneyFields(agg),
    }));
    all.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.orderId).localeCompare(String(b.orderId)));
  } else if (dataset === "products") {
    const byProduct = new Map<string, Agg>();
    for (const r of filtered) {
      const a = byProduct.get(r.productId) ?? baseAgg();
      addToAgg(a, r);
      byProduct.set(r.productId, a);
    }
    all = Array.from(byProduct.entries()).map(([productId, agg]) => ({ productId, ...moneyFields(agg) }));
    all.sort((a, b) => Number(b.revenuePoisha) - Number(a.revenuePoisha));
  } else {
    const byCustomer = new Map<string, { agg: Agg; first: string; last: string }>();
    for (const r of filtered) {
      const e = byCustomer.get(r.customerId) ?? { agg: baseAgg(), first: r.date, last: r.date };
      addToAgg(e.agg, r);
      if (r.date < e.first) e.first = r.date;
      if (r.date > e.last) e.last = r.date;
      byCustomer.set(r.customerId, e);
    }
    all = Array.from(byCustomer.entries()).map(([customerId, e]) => ({
      customerId,
      ...moneyFields(e.agg),
      firstOrderDate: e.first,
      lastOrderDate: e.last,
    }));
    all.sort((a, b) => Number(b.revenuePoisha) - Number(a.revenuePoisha));
  }

  const catalogue = reportColumnsFor(dataset, locale);
  const columns = definition.columns
    .map((key) => catalogue.find((c) => c.key === key))
    .filter((c): c is ReportColumn => c !== undefined);
  return { dataset, columns, rows: all };
}

/* ------------------------------------------------------------------ */
/* CSV + watermark — mirrors the sales export contract (W0-E).        */
/* ------------------------------------------------------------------ */

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export interface ExportWatermarkInput {
  title: string;
  exportedBy: string;
  exportedAt: Date;
  reason: string;
  range: DateRange;
  rowCount: number;
  definitionSummary: string;
}

/** The watermark header block, same shape as the sales/audit exports. */
export function buildExportWatermark(input: ExportWatermarkInput): string {
  return [
    `# ${input.title} — Advance Ecommerce`,
    `# exported-by: ${input.exportedBy}`,
    `# exported-at: ${dhakaTimestamp(input.exportedAt)} (Asia/Dhaka)`,
    `# reason: ${input.reason.replace(/\n/g, " ")}`,
    `# range: ${input.range.from}..${input.range.to} (Asia/Dhaka days)`,
    `# definition: ${input.definitionSummary.replace(/\n/g, " ")}`,
    `# rows: ${input.rowCount}`,
    "",
  ].join("\n");
}

export function describeDefinition(definition: ReportDefinition): string {
  const f = definition.filters;
  const parts = [`dataset=${definition.dataset}`, `columns=${definition.columns.join("|")}`];
  if (f.status) parts.push(`status=${f.status}`);
  if (f.district) parts.push(`district=${f.district}`);
  if (f.courier) parts.push(`courier=${f.courier}`);
  return parts.join("; ");
}

export function builtReportToCsv(built: BuiltReport, watermark: string): string {
  const header = built.columns.map((c) => csvEscape(c.key)).join(",");
  const lines = built.rows.map((row) =>
    built.columns.map((c) => csvEscape(String(row[c.key] ?? ""))).join(","),
  );
  return watermark + "\n" + [header, ...lines].join("\n") + "\n";
}
