// Order-import dry run + confirm (ADV-25). Confirm re-maps the file
// server-side (client row data is never trusted), re-validates, and
// creates each ready order through createManualOrder — its own
// transaction per order, exactly like the native CSV order import,
// so one bad order never leaves a half-imported order behind.
//
// Re-import safety: each source order gets a DETERMINISTIC
// idempotency key (UUIDv5-shaped, derived from source + source order
// id). A repeat confirm finds the existing order by that key and
// reports it as already-imported instead of creating a duplicate.

import { createHash } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";
import { parseCsv } from "@/catalog/import";
import { normalizeBdPhone } from "@/checkout/validation";
import { zoneForDistrict } from "@/checkout/shipping-core";
import { createManualOrder, type ManualCreateInput } from "@/orders/manual-create";
import { normalizeTable } from "./common";
import {
  ORDER_MAPPERS,
  ORDER_MAPPINGS,
  validateOrderGroups,
  type MappedOrderGroup,
  type OrderImportReport,
} from "./orders";
import type { ImportRefusal, OrderSourceId } from "./types";

export const MAX_ORDER_ROWS = 1000;
export const MAX_ORDER_GROUPS = 200;

const SOURCE_LABELS: Record<OrderSourceId, string> = {
  woocommerce: "WooCommerce",
  shopify: "Shopify",
};
const SOURCE_TAGS: Record<OrderSourceId, string> = {
  woocommerce: "woo-import",
  shopify: "shopify-import",
};

async function resolveVariants(
  groups: MappedOrderGroup[],
): Promise<Map<string, { id: string; pricePoisha: number }>> {
  const skus = [...new Set(groups.flatMap((g) => g.items.map((i) => i.sku)))];
  if (skus.length === 0) return new Map();
  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus }, deletedAt: null },
    select: { id: true, sku: true, pricePoisha: true },
  });
  return new Map(variants.map((v) => [v.sku, { id: v.id, pricePoisha: v.pricePoisha }]));
}

function mapAndValidate(source: OrderSourceId, csvText: string) {
  const table = parseCsv(csvText);
  const mapped = ORDER_MAPPERS[source](normalizeTable(table));
  return { table, mapped };
}

export async function dryRunOrderImport(input: {
  source: OrderSourceId;
  csvText: string;
  fileName?: string | null;
}): Promise<OrderImportReport | ImportRefusal> {
  const { table, mapped } = mapAndValidate(input.source, input.csvText);
  if (table.rows.length > MAX_ORDER_ROWS) {
    return {
      refused: true,
      code: "IMPORT_TOO_LARGE",
      message: `At most ${MAX_ORDER_ROWS} rows can be imported at once (got ${table.rows.length}). Split the export and import in parts.`,
    };
  }
  if (mapped.groups.length > MAX_ORDER_GROUPS) {
    return {
      refused: true,
      code: "IMPORT_TOO_LARGE",
      message: `At most ${MAX_ORDER_GROUPS} orders can be imported at once (got ${mapped.groups.length}). Split the export and import in parts.`,
    };
  }
  const variantBySku = await resolveVariants(mapped.groups);
  const verdicts = validateOrderGroups(mapped.groups, variantBySku);
  const currencies = [...new Set(mapped.groups.map((g) => g.currency).filter((c) => c !== ""))];
  return {
    source: input.source,
    kind: "orders",
    fileName: input.fileName ?? null,
    totalSourceRows: table.rows.length,
    orderCount: mapped.groups.length,
    readyCount: verdicts.filter((v) => v.status === "ready").length,
    skippedCount: verdicts.filter((v) => v.status === "skipped").length,
    orders: verdicts,
    unmappedColumns: mapped.unmappedColumns,
    consumedColumns: mapped.consumedColumns,
    notes: [
      ...mapped.notes,
      "Prices are NOT taken from the file: every imported order is priced from the live catalog (the platform's order-import rule), and shipping is computed by the shared engine from the district. Source order totals are therefore not carried over.",
      ...(currencies.length > 0
        ? [
            `Source currency recorded on orders: ${currencies.join(", ")}. No conversion is applied or needed, because file prices/totals are never used.`,
          ]
        : []),
      "Re-importing the same file is safe: each source order carries a deterministic idempotency key, so already-imported orders are reported, not duplicated.",
    ],
    mapping: ORDER_MAPPINGS[input.source],
  };
}

/** Deterministic UUID (v5-shaped) from a string, for idempotency keys. */
export function deterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5"; // version 5
  chars[16] = ((parseInt(chars[16] as string, 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const s = chars.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export interface OrderConfirmOutcome {
  sourceOrderId: string;
  status: "created" | "skipped" | "failed";
  orderId?: string;
  orderNo?: string;
  message?: string;
}

export interface OrderConfirmResult {
  source: OrderSourceId;
  totalOrders: number;
  created: number;
  skipped: number;
  failed: number;
  outcomes: OrderConfirmOutcome[];
}

export async function confirmOrderImport(input: {
  source: OrderSourceId;
  csvText: string;
  actor: { id: string; permissions: string[]; ip?: string; userAgent?: string };
}): Promise<OrderConfirmResult | ImportRefusal> {
  const { table, mapped } = mapAndValidate(input.source, input.csvText);
  if (table.rows.length > MAX_ORDER_ROWS || mapped.groups.length > MAX_ORDER_GROUPS) {
    return {
      refused: true,
      code: "IMPORT_TOO_LARGE",
      message: `At most ${MAX_ORDER_ROWS} rows / ${MAX_ORDER_GROUPS} orders can be imported at once (got ${table.rows.length} rows / ${mapped.groups.length} orders).`,
    };
  }
  const variantBySku = await resolveVariants(mapped.groups);
  const verdicts = validateOrderGroups(mapped.groups, variantBySku);

  const outcomes: OrderConfirmOutcome[] = [];
  for (const [groupIdx, group] of mapped.groups.entries()) {
    const verdict = verdicts[groupIdx];
    if (!verdict || verdict.status === "skipped") {
      outcomes.push({
        sourceOrderId: group.sourceOrderId,
        status: "skipped",
        message: verdict?.reasons.join(" ") ?? "Validation failed.",
      });
      continue;
    }
    const idempotencyKey = deterministicUuid(`${SOURCE_TAGS[input.source]}:${group.sourceOrderId}`);
    const existing = await prisma.order.findUnique({
      where: { idempotencyKey },
      select: { id: true, orderNo: true },
    });
    if (existing) {
      outcomes.push({
        sourceOrderId: group.sourceOrderId,
        status: "skipped",
        orderId: existing.id,
        orderNo: existing.orderNo,
        message: `Already imported as order ${existing.orderNo} — not duplicated.`,
      });
      continue;
    }
    const phone = normalizeBdPhone(group.phoneRaw) as string;
    const items: ManualCreateInput["items"] = group.items.map((item) => {
      const variant = variantBySku.get(item.sku) as { id: string; pricePoisha: number };
      return { variantId: variant.id, quantity: item.quantity, unitPricePoisha: variant.pricePoisha };
    });
    const noteParts = [
      `Imported from ${SOURCE_LABELS[input.source]} order #${group.sourceOrderId}`,
      group.statusRaw ? `source status: ${group.statusRaw}` : "",
      group.dateRaw ? `source date: ${group.dateRaw}` : "",
      group.paymentMethodNote ?? "",
      "Upazila set from source city (not present in source) — verify.",
    ].filter((p) => p !== "");
    try {
      const result = await createManualOrder(
        {
          phone,
          customerName: group.customerName,
          address: {
            division: group.division,
            district: group.district,
            upazila: group.upazila,
            addressLine: group.addressLine,
          },
          items,
          paymentMethod: group.paymentMethod,
          shippingMethod: zoneForDistrict(group.district),
          note: group.customerNote ? group.customerNote.slice(0, 500) : undefined,
          source: SOURCE_TAGS[input.source],
          internalNote: noteParts.join(" · ").slice(0, 500),
          idempotencyKey,
        },
        input.actor,
      );
      if (!result.ok) {
        outcomes.push({
          sourceOrderId: group.sourceOrderId,
          status: "failed",
          message: `${result.code}: ${result.message}`,
        });
      } else {
        outcomes.push({
          sourceOrderId: group.sourceOrderId,
          status: "created",
          orderId: result.orderId,
          orderNo: result.orderNo,
        });
      }
    } catch (error) {
      outcomes.push({
        sourceOrderId: group.sourceOrderId,
        status: "failed",
        message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  return {
    source: input.source,
    totalOrders: outcomes.length,
    created: outcomes.filter((o) => o.status === "created").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    outcomes,
  };
}
