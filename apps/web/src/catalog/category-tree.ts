/**
 * Public category tree (Wave 13-2, doc 16 §P2 remainder).
 *
 * GET /api/v1/public/categories used to return the repository's FLAT
 * list ({ slug, name, imageUrl, productCount }) — the tree structure
 * (Category.parentId) and the wave-13 SEO columns never reached the
 * storefront. This module keeps that flat read as the source of truth
 * for every field existing consumers depend on (same items, same
 * order, same product counts), then enriches each item with its
 * parent link + SEO fields from one extra Prisma query keyed by slug,
 * and assembles the nested tree:
 *
 *   PublicCategoryNode = Category & {
 *     seoTitle: { bn, en } | null,
 *     seoDescription: { bn, en } | null,
 *     children: PublicCategoryNode[],
 *   }
 *
 * Roots keep the flat read's order; children keep it too (the flat
 * read is globally ordered by sortOrder/nameEn, and grouping preserves
 * relative order). A category whose parent is missing from the public
 * set (inactive / soft-deleted parent) is promoted to a root rather
 * than dropped, and a parent cycle (the admin guards against them,
 * but belt-and-braces) also degrades to roots — the tree build can
 * never lose a category. productCount stays the DIRECT count, exactly
 * as the flat read computes it (children are not rolled up).
 *
 * If the enrichment query fails the build degrades to all-roots with
 * null SEO — still a valid, consumer-compatible response, never worse
 * than the old flat list.
 */
import { prisma } from "@advance-ecommerce/db";
import { getCatalogRepository } from "./api";
import type { Category } from "./types";

export interface PublicCategoryNode extends Category {
  seoTitle: { bn: string | null; en: string | null } | null;
  seoDescription: { bn: string | null; en: string | null } | null;
  children: PublicCategoryNode[];
}

interface CategoryTreeExtra {
  parentSlug: string | null;
  seoTitleBn: string | null;
  seoTitleEn: string | null;
  seoDescriptionBn: string | null;
  seoDescriptionEn: string | null;
}

function cleanText(value: string | null): string | null {
  return value !== null && value.trim() !== "" ? value : null;
}

function seoPair(
  bn: string | null,
  en: string | null,
): { bn: string | null; en: string | null } | null {
  const cleanBn = cleanText(bn);
  const cleanEn = cleanText(en);
  return cleanBn === null && cleanEn === null ? null : { bn: cleanBn, en: cleanEn };
}

async function fetchTreeExtras(): Promise<Map<string, CategoryTreeExtra>> {
  const rows = await prisma.category.findMany({
    where: { deletedAt: null, isActive: true },
    select: {
      slug: true,
      parent: { select: { slug: true } },
      seoTitleBn: true,
      seoTitleEn: true,
      seoDescriptionBn: true,
      seoDescriptionEn: true,
    },
  });
  const extras = new Map<string, CategoryTreeExtra>();
  for (const row of rows) {
    extras.set(row.slug, {
      parentSlug: row.parent?.slug ?? null,
      seoTitleBn: row.seoTitleBn,
      seoTitleEn: row.seoTitleEn,
      seoDescriptionBn: row.seoDescriptionBn,
      seoDescriptionEn: row.seoDescriptionEn,
    });
  }
  return extras;
}

/** True when following parentSlug links from `slug` leads back to it. */
function chainLoops(slug: string, parentOf: Map<string, string | null>): boolean {
  const seen = new Set<string>([slug]);
  let cursor = parentOf.get(slug) ?? null;
  while (cursor !== null) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}

export function buildPublicCategoryTree(
  flat: Category[],
  extras: Map<string, CategoryTreeExtra>,
): PublicCategoryNode[] {
  const nodes = new Map<string, PublicCategoryNode>();
  const parentOf = new Map<string, string | null>();
  for (const category of flat) {
    const extra = extras.get(category.slug);
    nodes.set(category.slug, {
      ...category,
      seoTitle: extra ? seoPair(extra.seoTitleBn, extra.seoTitleEn) : null,
      seoDescription: extra ? seoPair(extra.seoDescriptionBn, extra.seoDescriptionEn) : null,
      children: [],
    });
    parentOf.set(category.slug, extra?.parentSlug ?? null);
  }

  const roots: PublicCategoryNode[] = [];
  for (const category of flat) {
    const node = nodes.get(category.slug);
    if (!node) continue;
    const parentSlug = parentOf.get(category.slug) ?? null;
    const parent = parentSlug !== null ? nodes.get(parentSlug) : undefined;
    if (parent && parentSlug !== category.slug && !chainLoops(category.slug, parentOf)) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/**
 * The public tree: repository flat read + hierarchy/SEO enrichment.
 * Repository failures (DB not ready) propagate to the caller; only
 * the enrichment is allowed to degrade (to a flat, SEO-less tree).
 */
export async function getPublicCategoryTree(): Promise<PublicCategoryNode[]> {
  const repo = await getCatalogRepository();
  const flat = await repo.getCategories();
  let extras = new Map<string, CategoryTreeExtra>();
  try {
    extras = await fetchTreeExtras();
  } catch {
    // Degrade to roots + null SEO — the flat fields stay exact.
    extras = new Map<string, CategoryTreeExtra>();
  }
  return buildPublicCategoryTree(flat, extras);
}

/** Depth-first lookup by slug across the whole tree; null on any failure. */
export async function findPublicCategoryBySlug(slug: string): Promise<PublicCategoryNode | null> {
  try {
    const tree = await getPublicCategoryTree();
    const stack: PublicCategoryNode[] = [...tree];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node) break;
      if (node.slug === slug) return node;
      stack.push(...node.children);
    }
    return null;
  } catch {
    return null;
  }
}
