/**
 * Subscription-box read models (ADV-23 vertical 4, wave 56) — the
 * projections the PDP section, the account page and the admin boxes
 * page render from. Everything here is a READ over the wave-51
 * Subscription rows + the boxes Setting docs; the write paths stay
 * where they already live (subscription create in
 * src/subscriptions/service.ts, config/contents in the boxes doc
 * stores).
 */
import { prisma } from "@advance-ecommerce/db";
import {
  addInterval,
  listSubscriptionsForAdmin,
  loadSubscriptionDiscountBps,
  type SubscriptionView,
} from "@/subscriptions/service";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { effectiveBoxDiscountBps, isBoxVariantId, loadBoxesConfig, type BoxesConfig } from "./config";
import { findCycleContents, loadBoxContents, type BoxContentItem, type BoxCycleContents } from "./contents";
import {
  CYCLE_INTERVALS,
  boxCycleKeyFromNoteText,
  cycleKeyForInterval,
  type BoxCycleKind,
} from "./cycles";
import { subscriptionBoxesEnabled } from "./flags";

/** Same variant-label rule as the subscription service (attributes
 *  values joined, else the standard label) — duplicated because the
 *  original is module-private; both read the same attributes JSON. */
function variantLabel(attributes: unknown): string {
  if (typeof attributes === "object" && attributes !== null && !Array.isArray(attributes)) {
    const values = Object.values(attributes as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => v !== "");
    if (values.length > 0) return values.join(" / ");
  }
  return "স্ট্যান্ডার্ড";
}

/* ------------------------------------------------------------------ */
/* PDP                                                                 */
/* ------------------------------------------------------------------ */

export interface BoxCyclePreview {
  cycleKey: string;
  /** Null = the merchant has not announced this cycle's contents
   *  yet. The PDP says so plainly; generation will skip the cycle
   *  if the contents are still missing when it falls due. */
  cycle: BoxCycleContents | null;
}

export interface BoxPdpData {
  /** Cycle kinds the PDP may offer (from boxes.config.cycles). */
  cycles: BoxCycleKind[];
  /** Effective subscriber discount (box discount, else global). */
  discountBps: number;
  /** Per box variant, per offered interval: the cycle the FIRST
   *  generated box will belong to + its announced contents. */
  previews: Record<string, Partial<Record<"WEEKLY" | "MONTHLY", BoxCyclePreview>>>;
}

/** PDP data for a product's variants — null unless BOTH flags are
 *  on AND at least one of the variants is a listed box (the
 *  getWeightedInfosForProduct contract: ~zero cost while off, and
 *  the page renders the generic Subscribe & Save section instead). */
export async function getBoxPdpData(
  variantIds: string[],
  now: Date = new Date(),
): Promise<BoxPdpData | null> {
  if (!subscriptionsEnabled() || !subscriptionBoxesEnabled()) return null;
  const loaded = await loadBoxesConfig();
  const boxIds = variantIds.filter((id) => isBoxVariantId(loaded.config, id));
  if (boxIds.length === 0) return null;

  const discountBps = effectiveBoxDiscountBps(
    loaded.config,
    await loadSubscriptionDiscountBps(),
  );
  const previews: BoxPdpData["previews"] = {};
  for (const variantId of boxIds) {
    const doc = await loadBoxContents(variantId);
    const perInterval: Partial<Record<"WEEKLY" | "MONTHLY", BoxCyclePreview>> = {};
    for (const kind of loaded.config.cycles) {
      const interval = CYCLE_INTERVALS[kind];
      const firstRunAt = addInterval(now, interval);
      const cycleKey = cycleKeyForInterval(interval, firstRunAt);
      perInterval[interval] = { cycleKey, cycle: findCycleContents(doc, cycleKey) };
    }
    previews[variantId] = perInterval;
  }
  return { cycles: loaded.config.cycles, discountBps, previews };
}

/* ------------------------------------------------------------------ */
/* Account page + admin list extras                                    */
/* ------------------------------------------------------------------ */

export interface BoxSubscriptionExtra {
  subscriptionId: string;
  /** The cycle the NEXT generation will belong to — derived from
   *  the row's current nextRunAt, the same derivation the sweep
   *  will make when the cycle falls due. */
  nextCycleKey: string;
  nextContents: BoxCycleContents | null;
  /** The cycle the LAST generated order actually carried — parsed
   *  from the `[box:<cycleKey>]` marker in that order's note, so
   *  it stays exact even if the order was generated late. */
  lastCycleKey: string | null;
  lastContents: BoxCycleContents | null;
}

/** Box extras for a set of subscription views — {} when the box
 *  layer is OFF or none of the rows are box subscriptions. */
export async function getBoxExtrasForSubscriptions(
  subs: SubscriptionView[],
): Promise<Record<string, BoxSubscriptionExtra>> {
  if (!subscriptionBoxesEnabled()) return {};
  const loaded = await loadBoxesConfig();
  const boxSubs = subs.filter((s) => isBoxVariantId(loaded.config, s.variantId));
  if (boxSubs.length === 0) return {};

  const docs = new Map<string, Awaited<ReturnType<typeof loadBoxContents>>>();
  for (const variantId of new Set(boxSubs.map((s) => s.variantId))) {
    docs.set(variantId, await loadBoxContents(variantId));
  }

  const extras: Record<string, BoxSubscriptionExtra> = {};
  for (const sub of boxSubs) {
    const doc = docs.get(sub.variantId) ?? null;
    const nextCycleKey = cycleKeyForInterval(sub.interval, new Date(sub.nextRunAt));
    let lastCycleKey: string | null = null;
    if (sub.lastOrderId !== null) {
      const note = await prisma.orderNote.findFirst({
        where: { orderId: sub.lastOrderId, text: { contains: "[box:" } },
        orderBy: { createdAt: "desc" },
        select: { text: true },
      });
      if (note !== null) lastCycleKey = boxCycleKeyFromNoteText(note.text);
    }
    extras[sub.id] = {
      subscriptionId: sub.id,
      nextCycleKey,
      nextContents: findCycleContents(doc, nextCycleKey),
      lastCycleKey,
      lastContents: lastCycleKey !== null ? findCycleContents(doc, lastCycleKey) : null,
    };
  }
  return extras;
}

export interface BoxAdminRow {
  view: SubscriptionView;
  extra: BoxSubscriptionExtra;
}

/** Admin boxes list: the box subscriptions only (of the wave-51
 *  admin list), each with its cycle extras. */
export async function listBoxSubscriptionsForAdmin(): Promise<{
  rows: BoxAdminRow[];
  config: BoxesConfig;
}> {
  const loaded = await loadBoxesConfig();
  const all = await listSubscriptionsForAdmin();
  const boxViews = all.filter((s) => isBoxVariantId(loaded.config, s.variantId));
  const extras = await getBoxExtrasForSubscriptions(boxViews);
  return {
    config: loaded.config,
    rows: boxViews
      .filter((view) => extras[view.id] !== undefined)
      .map((view) => ({ view, extra: extras[view.id] as BoxSubscriptionExtra })),
  };
}

/* ------------------------------------------------------------------ */
/* Admin contents editor                                               */
/* ------------------------------------------------------------------ */

export interface BoxVariantSummary {
  variantId: string;
  productName: string | null;
  variantLabel: string | null;
  sku: string | null;
  definedCycleKeys: string[];
}

/** The configured box variants with display names + which cycles
 *  already have contents — the contents editor's variant picker. */
export async function listBoxVariantSummaries(): Promise<BoxVariantSummary[]> {
  const loaded = await loadBoxesConfig();
  const summaries: BoxVariantSummary[] = [];
  for (const variantId of loaded.config.boxVariantIds) {
    const [variant, doc] = await Promise.all([
      prisma.productVariant.findUnique({
        where: { id: variantId },
        select: { sku: true, attributes: true, product: { select: { titleBn: true } } },
      }),
      loadBoxContents(variantId),
    ]);
    summaries.push({
      variantId,
      productName: variant?.product.titleBn ?? null,
      variantLabel: variant ? variantLabel(variant.attributes) : null,
      sku: variant?.sku ?? null,
      definedCycleKeys: doc?.cycles.map((c) => c.cycleKey) ?? [],
    });
  }
  return summaries;
}

export interface BoxVariantOption {
  variantId: string;
  sku: string;
  productName: string;
  variantLabel: string;
  pricePoisha: number;
  stock: number;
}

/** Real-variant search for the contents editor's item rows (SKU or
 *  product title, Bangla or English). Empty query -> no results:
 *  the editor always searches, it never dumps the catalog. */
export async function searchVariantsForContents(query: string): Promise<BoxVariantOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const rows = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      product: { deletedAt: null },
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { product: { titleBn: { contains: q } } },
        { product: { titleEn: { contains: q } } },
      ],
    },
    orderBy: { sku: "asc" },
    take: 20,
    select: {
      id: true,
      sku: true,
      attributes: true,
      pricePoisha: true,
      stock: true,
      product: { select: { titleBn: true } },
    },
  });
  return rows.map((r) => ({
    variantId: r.id,
    sku: r.sku,
    productName: r.product.titleBn,
    variantLabel: variantLabel(r.attributes),
    pricePoisha: r.pricePoisha,
    stock: r.stock,
  }));
}

export type SnapshotContentItemsResult =
  | { ok: true; items: BoxContentItem[] }
  | { ok: false; missingVariantId: string };

/** Resolve editor-submitted { variantId, quantity } rows against
 *  the real catalog and snapshot name/SKU/label into the stored
 *  item shape. A variant that does not exist (or was deleted)
 *  fails the whole save — contents are never stored pointing at a
 *  phantom variant. */
export async function snapshotContentItems(
  rawItems: { variantId: string; quantity: number }[],
): Promise<SnapshotContentItemsResult> {
  const ids = [...new Set(rawItems.map((i) => i.variantId))];
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: ids }, deletedAt: null, product: { deletedAt: null } },
    select: {
      id: true,
      sku: true,
      attributes: true,
      product: { select: { titleBn: true } },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items: BoxContentItem[] = [];
  for (const raw of rawItems) {
    const row = byId.get(raw.variantId);
    if (row === undefined) return { ok: false, missingVariantId: raw.variantId };
    items.push({
      variantId: row.id,
      quantity: raw.quantity,
      productName: row.product.titleBn,
      sku: row.sku,
      variantLabel: variantLabel(row.attributes),
    });
  }
  return { ok: true, items };
}
