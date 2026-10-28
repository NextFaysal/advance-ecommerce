/**
 * Landing catalog resolution (doc 34 §3.4) — the ONE interface the
 * landing layer resolves products through.
 *
 * Why it exists: before L1, every landing surface resolved refs
 * against a `listProducts(pageSize: 100)` snapshot — a page that
 * referenced the 101st ACTIVE product rendered "unavailable" and
 * FAILED publish validation purely because of catalog size (audit
 * gap #17). Referenced products now resolve BY ID (and by slug),
 * collections resolve through bounded query methods, and publish
 * validation runs against the same by-id path — a valid product can
 * never fail for catalog size again.
 *
 * Two visibilities, mirroring the catalog's own rules:
 *  - `landingCatalogQueries` (admin/validation): ACTIVE products,
 *    scheduled (future publishAt) included — exactly the semantics
 *    the old ACTIVE list had for validateLandingPage.
 *  - `landingCatalogQueriesPublic` (public render): ACTIVE +
 *    liveOnly — the publishAt read-time gate applies, like every
 *    other public read (src/catalog/server-read).
 *
 * Everything returns the landing layer's own minimal shape
 * (LandingCatalogProduct) via an allowlist mapper: cost fields can
 * never enter a landing object graph, whatever the source shape was.
 * Prices/stock are the catalog's live values at call time — nothing
 * here is ever written back into sectionsJson (§0.2).
 */
import { prisma } from "@advance-ecommerce/db";
import { tryCatalogRepository } from "@/catalog/server-read";
import type { CatalogRepository } from "@/catalog/service";
import type { Product } from "@/catalog/types";
import type { LandingCatalogProduct, LandingPage } from "./types";

/** Collection bounds: a landing block never needs more than this. */
const MAX_LIMIT = 100;

function clampLimit(limit: number): number {
  return Math.min(Math.max(1, Math.floor(limit) || 1), MAX_LIMIT);
}

/** Allowlist map: catalog Product → the landing layer's minimal shape. */
export function toLandingCatalogProduct(p: Product): LandingCatalogProduct {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    images: p.images.map((i) => ({ url: i.url })),
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      pricePoisha: v.pricePoisha,
      compareAtPoisha: v.compareAtPoisha,
      stock: v.stock,
      isActive: v.isActive,
      imageUrl: v.imageUrl,
      attributes: v.attributes,
    })),
  };
}

export interface LandingCatalogQueries {
  /** Resolve referenced products by id — order of `ids` preserved,
   *  missing/invisible products silently absent (callers treat an
   *  absent ref as unresolved, exactly like the old list `find`). */
  byIds(ids: readonly string[]): Promise<LandingCatalogProduct[]>;
  /** Resolve one product by slug, or null. */
  bySlug(slug: string): Promise<LandingCatalogProduct | null>;
  /** Live category membership, newest first, bounded by `limit`. */
  byCategory(slug: string, limit: number): Promise<LandingCatalogProduct[]>;
  /** Live tag membership, newest first, bounded by `limit`. */
  byTag(tag: string, limit: number): Promise<LandingCatalogProduct[]>;
  /**
   * Best sellers from REAL sales: units summed over order lines of
   * non-CANCELLED, non-deleted orders — the same sales rule the
   * reports dashboard uses (src/reports/dashboard.ts). Never a
   * curated or invented ranking.
   */
  topSold(limit: number): Promise<LandingCatalogProduct[]>;
  /** Newest ACTIVE products first, bounded by `limit`. */
  newest(limit: number): Promise<LandingCatalogProduct[]>;
}

class LandingCatalogQueriesImpl implements LandingCatalogQueries {
  constructor(private readonly liveOnly: boolean) {}

  private visible(p: Product): boolean {
    if (p.status !== "ACTIVE") return false;
    if (this.liveOnly && p.publishAt && Date.parse(p.publishAt) > Date.now()) return false;
    return true;
  }

  async byIds(ids: readonly string[]): Promise<LandingCatalogProduct[]> {
    const repo = await tryCatalogRepository();
    if (!repo) return [];
    const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
    if (unique.length === 0) return [];
    const found = await Promise.all(unique.map((id) => repo.getProductById(id)));
    const out: LandingCatalogProduct[] = [];
    for (const p of found) {
      if (p && this.visible(p)) out.push(toLandingCatalogProduct(p));
    }
    return out;
  }

  async bySlug(slug: string): Promise<LandingCatalogProduct | null> {
    const repo: CatalogRepository | null = await tryCatalogRepository();
    if (!repo) return null;
    if (this.liveOnly) {
      // The repository's public read carries the ACTIVE + publishAt
      // gate in its own layer — reuse it rather than re-deriving it.
      const p = await repo.getPublicProductBySlug(slug);
      return p ? toLandingCatalogProduct(p) : null;
    }
    const p = await repo.getProductBySlug(slug);
    return p && this.visible(p) ? toLandingCatalogProduct(p) : null;
  }

  async byCategory(slug: string, limit: number): Promise<LandingCatalogProduct[]> {
    const repo = await tryCatalogRepository();
    if (!repo) return [];
    const { products } = await repo.listProducts({
      status: "ACTIVE",
      categorySlug: slug,
      page: 1,
      pageSize: clampLimit(limit),
      liveOnly: this.liveOnly,
    });
    return products.map(toLandingCatalogProduct);
  }

  async byTag(tag: string, limit: number): Promise<LandingCatalogProduct[]> {
    // The repository's filter surface has no tag predicate, so the
    // candidate ids come from a bounded Prisma id query (the landing
    // store already reads Prisma directly); full products then
    // resolve through byIds, keeping ONE mapping/visibility path.
    const rows = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        tags: { has: tag },
        ...(this.liveOnly
          ? { OR: [{ publishAt: null }, { publishAt: { lte: new Date() } }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: clampLimit(limit),
      select: { id: true },
    });
    return this.byIds(rows.map((r) => r.id));
  }

  async topSold(limit: number): Promise<LandingCatalogProduct[]> {
    const bounded = clampLimit(limit);
    const grouped = await prisma.orderItem.groupBy({
      by: ["variantId"],
      where: { order: { deletedAt: null, status: { not: "CANCELLED" } } },
      _sum: { quantity: true },
    });
    if (grouped.length === 0) return [];
    const variants = await prisma.productVariant.findMany({
      where: { id: { in: grouped.map((g) => g.variantId) } },
      select: { id: true, productId: true },
    });
    const productByVariant = new Map(variants.map((v) => [v.id, v.productId]));
    const unitsByProduct = new Map<string, number>();
    for (const g of grouped) {
      const productId = productByVariant.get(g.variantId);
      if (!productId) continue;
      const units = Number(g._sum.quantity ?? 0);
      unitsByProduct.set(productId, (unitsByProduct.get(productId) ?? 0) + units);
    }
    const rankedIds = [...unitsByProduct.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    // byIds preserves input order (= sales rank) and drops
    // inactive/invisible products; over-fetch candidates so dropped
    // rows cannot shrink the result below the requested limit.
    const resolved = await this.byIds(rankedIds.slice(0, bounded * 3));
    return resolved.slice(0, bounded);
  }

  async newest(limit: number): Promise<LandingCatalogProduct[]> {
    const repo = await tryCatalogRepository();
    if (!repo) return [];
    const { products } = await repo.listProducts({
      status: "ACTIVE",
      sort: "newest",
      page: 1,
      pageSize: clampLimit(limit),
      liveOnly: this.liveOnly,
    });
    return products.map(toLandingCatalogProduct);
  }
}

/** Admin/validation visibility: ACTIVE, scheduled products included. */
export const landingCatalogQueries: LandingCatalogQueries = new LandingCatalogQueriesImpl(false);

/** Public render visibility: ACTIVE + the publishAt live gate. */
export const landingCatalogQueriesPublic: LandingCatalogQueries = new LandingCatalogQueriesImpl(true);

/**
 * Every catalog product id a page's sections reference (product_offer
 * + quick_order today; the dynamic blocks of L2 add their manual
 * picks here as they land). Resolution inputs for byIds — the public
 * page, the builder's server parent and both API routes all collect
 * refs through this one function.
 */
export function referencedProductIds(page: Pick<LandingPage, "sections">): string[] {
  const ids: string[] = [];
  for (const section of page.sections) {
    if (section.type === "product_offer" || section.type === "quick_order") {
      if (section.productId) ids.push(section.productId);
    }
  }
  return ids;
}
