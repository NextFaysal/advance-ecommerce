/**
 * Daily digest (ADV-27 remainder, doc 22) — one Dhaka day of store
 * numbers as a formatted bn/en text, delivered by email.
 *
 * DEFINITIONS (audited against src/reports/dashboard.ts — the digest
 * must never disagree with the dashboard home):
 * - orders          = COUNT of orders CREATED that Dhaka day
 *                     (non-deleted), all statuses.
 * - revenuePoisha   = the dashboard's revenue: Σ order-item
 *                     unitPricePoisha × qty for orders created that
 *                     day, excluding CANCELLED orders (fetchSalesRows
 *                     + aggregateSales, unchanged).
 * - delivered*      = orders transitioned INTO DELIVERED that day
 *                     (OrderStatusHistory.createdAt in the day) and
 *                     Σ their Order.totalPoisha — the cash-side view,
 *                     reported SEPARATELY, never blended with the
 *                     creation-day revenue above.
 * - countsByStatus  = current all-time snapshot by status (labelled
 *                     as a snapshot — it is not "that day" data).
 * - lowStockCount   = variants at/below LOW_STOCK_THRESHOLD on the
 *                     canonical ProductVariant.stock cache, the
 *                     dashboard's exact method.
 * - topProducts     = by units sold that day (same sales rows,
 *                     CANCELLED excluded).
 *
 * DELIVERY — email only, through the ADV-3 producer
 * (src/email/send.ts enqueueEmailJob), one job per recipient.
 * HONESTY: enqueueing is NOT sending. The result says "queued" only
 * when the job really landed in Redis, and even then the email is
 * queued-not-sent until a worker process (production: the future VPS
 * worker) picks it up AND a transport is configured. There is no
 * Telegram/Slack path: no notify service exists in src/connectors
 * (checked 2026-10-26 — the directory does not exist), so none is
 * faked here.
 *
 * SEND-PATH: the worker's processEmailJob has a "daily_digest" case
 * (wired at wave-43 integration): it rebuilds the digest via
 * buildDailyDigest(date from the job's recipientRef) at send time,
 * the report_delivery ids-only pattern. Jobs still only QUEUE until
 * the worker host exists — queued is not sent.
 */
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { dhakaDayRangeUtc, todayDhakaYmd } from "@/lib/dhaka-date";
import { fetchSalesRows } from "@/reports/db-rows";
import { aggregateSales } from "@/reports/service";
import {
  LOW_STOCK_THRESHOLD,
  getVariantStockCacheDb,
  listInventoryItemsDb,
} from "@/inventory/repository";
import { enqueueEmailJob, type EnqueueEmailResult } from "@/email/send";
import { addQty } from "@/lib/quantity";
import { readDoc, writeDoc } from "./docs";

export interface DailyDigest {
  date: string;
  orders: number;
  revenuePoisha: number;
  deliveredOrders: number;
  deliveredRevenuePoisha: number;
  countsByStatus: Record<string, number>;
  lowStockCount: number;
  lowStockThreshold: number;
  topProducts: { productId: string; titleBn: string; titleEn: string; units: number }[];
}

export async function buildDailyDigest(ymd: string): Promise<DailyDigest> {
  const rows = await fetchSalesRows({ from: ymd, to: ymd });
  const totals = aggregateSales(rows, { from: ymd, to: ymd }, false).totals;

  const { startUtc, endUtc } = dhakaDayRangeUtc(ymd);
  const [ordersCount, deliveredHistory, grouped, items] = await Promise.all([
    prisma.order.count({
      where: { deletedAt: null, createdAt: { gte: startUtc, lte: endUtc } },
    }),
    prisma.orderStatusHistory.findMany({
      where: { to: "DELIVERED", createdAt: { gte: startUtc, lte: endUtc } },
      select: { orderId: true },
    }),
    prisma.order.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
    listInventoryItemsDb(),
  ]);

  // Delivered-that-day revenue from the orders' recorded totals.
  const deliveredIds = [...new Set(deliveredHistory.map((h) => h.orderId))];
  let deliveredRevenuePoisha = 0;
  if (deliveredIds.length > 0) {
    const deliveredOrders = await prisma.order.findMany({
      where: { id: { in: deliveredIds }, deletedAt: null },
      select: { totalPoisha: true },
    });
    deliveredRevenuePoisha = deliveredOrders.reduce((s, o) => s + o.totalPoisha, 0);
  }

  const countsByStatus: Record<string, number> = {};
  for (const g of grouped) countsByStatus[g.status as string] = g._count._all;

  // Low stock — the dashboard's exact method (canonical variant cache,
  // per-variant fallback to Σ quantityAvailable across warehouses).
  const stockCache = await getVariantStockCacheDb([...new Set(items.map((i) => i.variantId))]);
  const fallback = new Map<string, number>();
  for (const i of items) {
    fallback.set(i.variantId, (fallback.get(i.variantId) ?? 0) + i.quantityAvailable);
  }
  let lowStockCount = 0;
  for (const variantId of fallback.keys()) {
    const available = stockCache.get(variantId) ?? (fallback.get(variantId) ?? 0);
    if (available <= LOW_STOCK_THRESHOLD) lowStockCount += 1;
  }

  // Top 5 products by units — same rows + filter as the revenue.
  const unitsByProduct = new Map<string, number>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    unitsByProduct.set(r.productId, addQty(unitsByProduct.get(r.productId) ?? 0, r.quantity));
  }
  const topIds = [...unitsByProduct.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);
  const products = topIds.length
    ? await prisma.product.findMany({
        where: { id: { in: topIds } },
        select: { id: true, titleBn: true, titleEn: true },
      })
    : [];
  const titleOf = new Map(products.map((p) => [p.id, p]));
  const topProducts = topIds.map((id) => ({
    productId: id,
    titleBn: titleOf.get(id)?.titleBn ?? id,
    titleEn: titleOf.get(id)?.titleEn ?? id,
    units: unitsByProduct.get(id) ?? 0,
  }));

  return {
    date: ymd,
    orders: ordersCount,
    revenuePoisha: totals.revenuePoisha,
    deliveredOrders: deliveredIds.length,
    deliveredRevenuePoisha,
    countsByStatus,
    lowStockCount,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    topProducts,
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function taka(poisha: number): string {
  return `৳${(poisha / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

const STATUS_ORDER = [
  "PENDING", "CONFIRMED", "PROCESSING", "PACKED", "SHIPPED",
  "DELIVERED", "RETURNED", "REFUNDED", "CANCELLED", "FAILED",
] as const;

function statusLines(digest: DailyDigest): [string, number][] {
  const known = STATUS_ORDER.filter((s) => (digest.countsByStatus[s] ?? 0) > 0).map(
    (s) => [s, digest.countsByStatus[s] as number] as [string, number],
  );
  const extra = Object.entries(digest.countsByStatus).filter(
    ([s, n]) => n > 0 && !(STATUS_ORDER as readonly string[]).includes(s),
  );
  return [...known, ...extra];
}

export function renderDigestText(digest: DailyDigest, locale: "bn" | "en"): string {
  const statuses = statusLines(digest);
  if (locale === "bn") {
    const lines = [
      `দৈনিক ডাইজেস্ট — ${digest.date} (Asia/Dhaka)`,
      ``,
      `আজকের অর্ডার: ${digest.orders}টি`,
      `বিক্রয় (অর্ডার তৈরির দিনের হিসাবে, বাতিল বাদে): ${taka(digest.revenuePoisha)}`,
      `আজ ডেলিভারি সম্পন্ন: ${digest.deliveredOrders}টি অর্ডার, মোট ${taka(digest.deliveredRevenuePoisha)}`,
      `কম স্টকের পণ্য (ভ্যারিয়েন্ট): ${digest.lowStockCount}টি (সীমা ≤ ${digest.lowStockThreshold})`,
      ``,
      `বর্তমান অর্ডার অবস্থা (সব সময়ের স্ন্যাপশট):`,
      ...statuses.map(([s, n]) => `  ${s}: ${n}টি`),
      ``,
      `সেরা ৫ পণ্য (আজ বিক্রিত ইউনিট):`,
      ...(digest.topProducts.length > 0
        ? digest.topProducts.map((p, i) => `  ${i + 1}. ${p.titleBn} — ${p.units}টি`)
        : [`  (আজ কোনো বিক্রি নেই)`]),
    ];
    return lines.join("\n");
  }
  const lines = [
    `Daily digest — ${digest.date} (Asia/Dhaka)`,
    ``,
    `Orders created today: ${digest.orders}`,
    `Sales (by order-creation day, excluding cancelled): ${taka(digest.revenuePoisha)}`,
    `Delivered today: ${digest.deliveredOrders} orders, ${taka(digest.deliveredRevenuePoisha)} in total`,
    `Low-stock variants: ${digest.lowStockCount} (threshold ≤ ${digest.lowStockThreshold})`,
    ``,
    `Current order status (all-time snapshot):`,
    ...statuses.map(([s, n]) => `  ${s}: ${n}`),
    ``,
    `Top 5 products (units sold today):`,
    ...(digest.topProducts.length > 0
      ? digest.topProducts.map((p, i) => `  ${i + 1}. ${p.titleEn} — ${p.units} units`)
      : [`  (no sales today)`]),
  ];
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Recipients + sending                                                */
/* ------------------------------------------------------------------ */

export const DIGEST_RECIPIENTS_KEY = "team.digest.recipients";

const recipientsDocSchema = z.object({
  version: z.literal(1),
  emails: z.array(z.string().email()).max(50),
});

export async function getDigestRecipients(): Promise<string[]> {
  const doc = await readDoc(DIGEST_RECIPIENTS_KEY, recipientsDocSchema, {
    version: 1 as const,
    emails: [],
  });
  return doc.emails;
}

export async function setDigestRecipients(emails: string[], actorId: string): Promise<string[]> {
  const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const parsed = recipientsDocSchema.safeParse({ version: 1, emails: cleaned });
  if (!parsed.success) {
    throw new Error("INVALID_RECIPIENTS");
  }
  await writeDoc(DIGEST_RECIPIENTS_KEY, parsed.data, actorId);
  return parsed.data.emails;
}

export interface DigestSendResult {
  date: string;
  recipients: string[];
  /** queued = jobs landed in Redis. NOT sent — see module header. */
  delivery: "queued" | "not_queued" | "no_recipients";
  results: { email: string; outcome: EnqueueEmailResult }[];
  note: string;
}

const QUEUED_NOTE =
  "Jobs are queued in Redis only — queued is not sent. Delivery needs the worker process and a configured email transport.";

export async function sendDailyDigest(ymd: string, _actorId: string): Promise<DigestSendResult> {
  const recipients = await getDigestRecipients();
  if (recipients.length === 0) {
    return { date: ymd, recipients, delivery: "no_recipients", results: [], note: QUEUED_NOTE };
  }
  const results: DigestSendResult["results"] = [];
  for (const email of recipients) {
    const outcome = await enqueueEmailJob(
      {
        templateKey: "daily_digest",
        toEmail: email,
        recipientRef: `digest:${ymd}`,
        idempotencyKey: `daily-digest-${ymd}-${email}`,
      },
      "daily-digest",
    );
    results.push({ email, outcome });
  }
  const allQueued = results.every((r) => r.outcome.email === "queued");
  return {
    date: ymd,
    recipients,
    delivery: allQueued ? "queued" : "not_queued",
    results,
    note: QUEUED_NOTE,
  };
}

/** Worker-tick entry point (ADV-1 VPS day): digest for TODAY (Dhaka).
 *  Exported and side-effect-scoped to exactly one sendDailyDigest
 *  call so a future scheduler can invoke it unchanged. */
export async function runDailyDigest(now: Date = new Date()): Promise<DigestSendResult> {
  return sendDailyDigest(todayDhakaYmd(now), "system:daily-digest");
}
