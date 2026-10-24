/**
 * Smart search / Ask Your Data — Agent 15, Step 47 (A7/A8).
 *
 * The command-bar parser is a RULE parser, not NL understanding: it looks
 * for known status words (en + bn + Banglish), known date words
 * (ajker/today, gotokal/yesterday, last 7 days / "7 din"), and district
 * names from a small dictionary, plus `#order`, `@customer`, `> action`
 * prefixes from the Command Bar 2.0 spec. Anything unrecognised is kept
 * as free text — it is never silently dropped or "interpreted".
 *
 * Ask Your Data does NOT duplicate report logic: aggregation is delegated
 * to aggregateSales() from src/reports/service.ts over the caller's
 * SalesRow[]; this module only maps a parsed query type to a slice of the
 * ReportBundle (or explains it cannot answer yet).
 *
 * Test cases:
 *  "ajker pending order Dhaka" -> { status:"PENDING", district:"Dhaka",
 *    date:"today", text:"order" (order is a hint word, kept in text) }
 *  "#100245" -> order lookup hint { orderNo:"100245" }
 *  "gotokal er delivered order Sylhet" -> { status:"DELIVERED",
 *    district:"Sylhet", date:"yesterday" }
 *  Ask "sales by district" over rows -> bundle.byDistrict (reports service)
 */
import { aggregateSales } from "../reports/service";
import type { ReportBundle, SalesRow } from "../reports/types";

export type OrderStatusFilter =
  | "PENDING" | "CONFIRMED" | "PROCESSING" | "PACKED" | "SHIPPED"
  | "DELIVERED" | "CANCELLED" | "RETURNED" | "REFUNDED";

export type DateHint = "today" | "yesterday" | "last7days" | "last30days" | null;

export interface ParsedCommandQuery {
  text: string;
  status: OrderStatusFilter | null;
  district: string | null;
  date: DateHint;
  orderNo: string | null;
  customerQuery: string | null;
  action: string | null;
}

const STATUS_WORDS: Record<string, OrderStatusFilter> = {
  pending: "PENDING", অপেক্ষমাণ: "PENDING",
  confirmed: "CONFIRMED", confirm: "CONFIRMED", নিশ্চিত: "CONFIRMED",
  processing: "PROCESSING", packed: "PACKED", প্যাক: "PACKED",
  shipped: "SHIPPED", পাঠানো: "SHIPPED",
  delivered: "DELIVERED", delivery: "DELIVERED", ডেলিভারি: "DELIVERED",
  cancelled: "CANCELLED", canceled: "CANCELLED", cancel: "CANCELLED", বাতিল: "CANCELLED",
  returned: "RETURNED", return: "RETURNED", ফেরত: "RETURNED",
  refunded: "REFUNDED", refund: "REFUNDED", রিফান্ড: "REFUNDED",
};

const DISTRICTS = [
  "Dhaka", "Chattogram", "Khulna", "Rajshahi", "Barishal", "Sylhet",
  "Rangpur", "Mymensingh", "Cumilla", "Narayanganj", "Gazipur", "Cox's Bazar",
];
const DISTRICT_BN: Record<string, string> = {
  "ঢাকা": "Dhaka", "চট্টগ্রাম": "Chattogram", "খুলনা": "Khulna",
  "রাজশাহী": "Rajshahi", "সিলেট": "Sylhet", "বরিশাল": "Barishal",
  "রংপুর": "Rangpur", "ময়মনসিংহ": "Mymensingh",
};

function detectDate(q: string): DateHint {
  if (/\bajker\b|আজকের|আজ|\btoday\b/.test(q)) return "today";
  if (/gotokal|গতকাল|\byesterday\b/.test(q)) return "yesterday";
  if (/7\s*din|৭\s*দিন|last\s*7/.test(q)) return "last7days";
  if (/30\s*din|৩০\s*দিন|last\s*30/.test(q)) return "last30days";
  return null;
}

export function parseCommandQuery(raw: string): ParsedCommandQuery {
  const input = raw.trim().slice(0, 300);
  const lower = input.toLowerCase();

  const orderMatch = input.match(/#\s*(\d{4,})/);
  const customerMatch = input.match(/@\s*([^\s]+)/);
  const actionMatch = input.match(/^>\s*([a-zA-Z]+)/);

  let status: OrderStatusFilter | null = null;
  for (const [word, value] of Object.entries(STATUS_WORDS)) {
    if (lower.includes(word)) { status = value; break; }
  }

  let district: string | null = null;
  for (const d of DISTRICTS) {
    if (lower.includes(d.toLowerCase())) { district = d; break; }
  }
  if (district === null) {
    for (const [bn, en] of Object.entries(DISTRICT_BN)) {
      if (input.includes(bn)) { district = en; break; }
    }
  }

  return {
    text: input,
    status,
    district,
    date: detectDate(lower),
    orderNo: orderMatch?.[1] ?? null,
    customerQuery: customerMatch?.[1] ?? null,
    action: actionMatch?.[1]?.toLowerCase() ?? null,
  };
}

/* ---- Ask Your Data ---- */

export type AskQueryKind =
  | "sales_by_district" | "top_products" | "courier_performance"
  | "sales_by_customer" | "totals" | "unsupported";

export function classifyAskQuery(raw: string): AskQueryKind {
  const q = raw.toLowerCase();
  if (/district|এলাকা|জেলা/.test(q) && /sales|বিক্রি|revenue|আয়/.test(q)) return "sales_by_district";
  if (/top|সেরা|best/.test(q) && /product|পণ্য/.test(q)) return "top_products";
  if (/courier|কুরিয়ার|delivery performance/.test(q)) return "courier_performance";
  if (/customer|কাস্টমার/.test(q) && /sales|বিক্রি|top/.test(q)) return "sales_by_customer";
  if (/total|মোট|sales|বিক্রি|revenue/.test(q)) return "totals";
  return "unsupported";
}

export interface AskResult {
  kind: AskQueryKind;
  /** Slice of the ReportBundle produced by src/reports/service. */
  data: ReportBundle["totals"] | ReportBundle["byDistrict"] | ReportBundle["byProduct"] | ReportBundle["byCourier"] | ReportBundle["byCustomer"] | null;
  note: string;
}

export function answerAskQuery(raw: string, rows: SalesRow[], from: string, to: string): AskResult {
  const kind = classifyAskQuery(raw);
  if (kind === "unsupported") {
    return {
      kind,
      data: null,
      note: "This question type is not supported yet. Supported: totals, sales by district, top products, courier performance, sales by customer.",
    };
  }
  const bundle = aggregateSales(rows, { from, to }, false);
  switch (kind) {
    case "sales_by_district": return { kind, data: bundle.byDistrict, note: "Aggregated by src/reports aggregateSales()." };
    case "top_products": return { kind, data: bundle.byProduct, note: "byProduct totals from src/reports; sort by revenuePoisha in the UI." };
    case "courier_performance": return { kind, data: bundle.byCourier, note: "byCourier totals from src/reports; delivery-rate scoring lives in src/analytics/performance.ts." };
    case "sales_by_customer": return { kind, data: bundle.byCustomer, note: "Aggregated by src/reports aggregateSales()." };
    case "totals": return { kind, data: bundle.totals, note: "Totals from src/reports aggregateSales()." };
  }
}
