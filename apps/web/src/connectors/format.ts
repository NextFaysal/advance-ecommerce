/**
 * Connector message formatting (ADV-25 part 2).
 *
 * Bangla + English mix, matching the house style of the admin UI and
 * customer notifications. Only SAFE summary fields are formatted —
 * the phone arrives already masked, and no address/email field
 * exists on a summary at all.
 */
import type {
  ConnectorChannel,
  ConnectorEvent,
  ConnectorSummary,
  OrderSummary,
} from "./types";

/** poisha -> "৳1,234.00" (same rendering as checkout's formatBdt;
 *  duplicated so this module keeps a dependency-light graph). */
export function formatBdt(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

const EVENT_HEADLINES: Record<ConnectorEvent, string> = {
  "order.created": "🛎️ নতুন অর্ডার / New order",
  "order.status_changed": "🔄 অর্ডারের অবস্থা বদলেছে / Order status changed",
  "payment.succeeded": "💰 পেমেন্ট সফল / Payment received",
  "stock.low": "⚠️ স্টক কমে গেছে / Low stock",
};

function orderLines(order: OrderSummary): string[] {
  return [
    `অর্ডার নম্বর / Order: ${order.orderNo}`,
    `কাস্টমার / Customer: ${order.customerName}`,
    `ফোন / Phone: ${order.phoneMasked}`,
    `মোট / Total: ${formatBdt(order.totalPoisha)}`,
    `পেমেন্ট / Payment: ${order.paymentMethod} (${order.paymentStatus})`,
    `স্ট্যাটাস / Status: ${order.status}`,
    `আইটেম / Items: ${order.itemCount}`,
  ];
}

/** Plain-text message for the chat channels (Slack / Telegram). */
export function formatConnectorMessage(
  event: ConnectorEvent | "test",
  summary: ConnectorSummary,
): string {
  if (summary.kind === "test") {
    return [
      "🧪 টেস্ট বার্তা / Test message",
      `এই বার্তাটি Advance Ecommerce-এর ${summary.channel} কানেক্টর টেস্ট থেকে পাঠানো হয়েছে — সংযোগ কাজ করছে। / Sent from the Advance Ecommerce ${summary.channel} connector test — the connection works.`,
    ].join("\n");
  }
  if (summary.kind === "stock") {
    return [
      EVENT_HEADLINES["stock.low"],
      ...(summary.stock.productName ? [`পণ্য / Product: ${summary.stock.productName}`] : []),
      `SKU: ${summary.stock.sku}`,
      `অবশিষ্ট স্টক / Remaining stock: ${summary.stock.available}`,
    ].join("\n");
  }
  const headline = event === "test" ? EVENT_HEADLINES["order.created"] : EVENT_HEADLINES[event];
  return [headline, ...orderLines(summary.order)].join("\n");
}

/**
 * One Google Sheets row for order.created (and the test attempt).
 * Column order is the sheet's contract — do not reorder casually:
 *   timestamp | orderNo | customer | phone (masked) | total (BDT) |
 *   status | payment method | event
 */
export function formatSheetsRow(
  event: ConnectorEvent | "test",
  summary: ConnectorSummary,
  at: Date,
): string[] {
  const timestamp = at.toISOString();
  if (summary.kind === "test") {
    return [timestamp, "TEST", "কানেক্টর টেস্ট / Connector test", "", "", "", "", event];
  }
  if (summary.kind !== "order") return [timestamp, "", "", "", "", "", "", event];
  const order = summary.order;
  return [
    timestamp,
    order.orderNo,
    order.customerName,
    order.phoneMasked,
    (order.totalPoisha / 100).toFixed(2),
    order.status,
    order.paymentMethod,
    event,
  ];
}

/** Channel display labels for the admin UI / ledger details. */
export const CHANNEL_LABELS: Record<ConnectorChannel, string> = {
  slack: "Slack",
  telegram: "Telegram",
  sheets: "Google Sheets",
};
