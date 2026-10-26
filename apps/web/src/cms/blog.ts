// Storefront blog reads — ADV-17 (doc 22). PUBLIC read path over the
// CmsPost table (admin CRUD lives in src/reports/cms.ts + /admin/content).
//
// VISIBILITY CONTRACT (the model's own semantics, nothing invented):
// a post is public iff status = "PUBLISHED" and deletedAt is null.
// The CMS store sets publishedAt = now at the moment a post is
// published (and back to null on draft/scheduled), so PUBLISHED rows
// always carry the date they went live. SCHEDULED is a label only —
// the schema has NO scheduledAt column, so scheduled posts are NOT
// public and never auto-publish from here. Soft-deleted rows
// (deletedAt set) are never public. Display date = publishedAt,
// falling back to createdAt for safety.
//
// Like src/catalog/server-read.ts, every DB helper resolves to an
// empty result instead of throwing when the DB is not ready — the
// blog renders its honest empty state, never mock posts.
//
// CmsPost has NO author and NO cover-image column, so bylines and
// card thumbnails do not exist on this surface — nothing is faked.

import { prisma } from "@advance-ecommerce/db";
import { descriptionToPlainText, renderDescriptionHtml } from "@/catalog/description";

/** The minimal CmsPost row shape these helpers consume. */
export interface BlogPostRow {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string | null;
  bodyBn: string;
  bodyEn: string | null;
  category: string | null;
  tags: string[];
  status: string;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BlogPostSummary {
  slug: string;
  titleBn: string;
  titleEn: string | null;
  category: string | null;
  tags: string[];
  publishedDate: string; // ISO
  excerpt: string;
  readingTimeMinutes: number;
}

export interface BlogPostFull extends BlogPostSummary {
  bodyBnHtml: string;
  bodyEnHtml: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
}

/* ------------------------- pure helpers ------------------------- */

/** The visibility predicate — the single source of truth the Prisma
 *  where-clause below mirrors exactly. */
export function isVisibleBlogPost(row: Pick<BlogPostRow, "status" | "deletedAt">): boolean {
  return row.status === "PUBLISHED" && row.deletedAt === null;
}

/** Prisma filter equivalent of isVisibleBlogPost (+ optional
 *  category). Kept as a pure builder so the contract is testable. */
export function publishedPostWhere(category?: string | null) {
  return {
    status: "PUBLISHED" as const,
    deletedAt: null,
    ...(category ? { category } : {}),
  };
}

const WORDS_PER_MINUTE = 200;

/** Reading time from the plain text of the Bangla body (the primary
 *  body); whitespace-tokenised, minimum 1 minute for a non-empty post. */
export function readingTimeMinutes(bodyBn: string): number {
  const words = descriptionToPlainText(bodyBn ?? "").split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

/** Card/feed excerpt: the SEO description wins when the merchant
 *  wrote one; otherwise the body's own plain text, truncated. */
export function blogExcerpt(row: Pick<BlogPostRow, "bodyBn" | "seoDescription">, maxLength = 180): string {
  const seo = (row.seoDescription ?? "").trim();
  if (seo) return seo;
  const text = descriptionToPlainText(row.bodyBn ?? "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function displayDate(row: Pick<BlogPostRow, "publishedAt" | "createdAt">): Date {
  return row.publishedAt ?? row.createdAt;
}

export function toBlogPostSummary(row: BlogPostRow): BlogPostSummary {
  return {
    slug: row.slug,
    titleBn: row.titleBn,
    titleEn: row.titleEn,
    category: row.category,
    tags: row.tags ?? [],
    publishedDate: displayDate(row).toISOString(),
    excerpt: blogExcerpt(row),
    readingTimeMinutes: readingTimeMinutes(row.bodyBn),
  };
}

export function toBlogPostFull(row: BlogPostRow): BlogPostFull {
  return {
    ...toBlogPostSummary(row),
    bodyBnHtml: renderDescriptionHtml(row.bodyBn ?? ""),
    bodyEnHtml: row.bodyEn ? renderDescriptionHtml(row.bodyEn) : null,
    seoTitle: row.seoTitle,
    seoDescription: row.seoDescription,
  };
}

export interface BlogPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function blogPagination(total: number, page: number, pageSize: number): BlogPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page: Math.min(Math.max(1, page), totalPages), pageSize, total, totalPages };
}

/* --------------------------- RSS feed --------------------------- */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** RSS 2.0 document for the given posts (already visibility-filtered
 *  + newest-first by the caller). Pure — smoke-tested without a DB. */
export function buildBlogRssXml(
  posts: BlogPostSummary[],
  opts: { baseUrl: string; siteTitle: string; siteDescription: string },
): string {
  const base = opts.baseUrl.replace(/\/$/, "");
  const items = posts
    .map((post) => {
      const link = `${base}/blog/${post.slug}`;
      const lines = [
        "    <item>",
        `      <title>${escapeXml(post.titleBn)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${new Date(post.publishedDate).toUTCString()}</pubDate>`,
        `      <description>${escapeXml(post.excerpt)}</description>`,
      ];
      if (post.category) lines.push(`      <category>${escapeXml(post.category)}</category>`);
      lines.push("    </item>");
      return lines.join("\n");
    })
    .join("\n");
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>${escapeXml(opts.siteTitle)}</title>`,
    `    <link>${escapeXml(`${base}/blog`)}</link>`,
    `    <description>${escapeXml(opts.siteDescription)}</description>`,
    "    <language>bn</language>",
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/* ------------------------- DB read path ------------------------- */

export const BLOG_PAGE_SIZE = 9;

export interface BlogListResult {
  posts: BlogPostSummary[];
  pagination: BlogPagination;
}

export async function listPublishedPosts(opts: {
  page?: number;
  pageSize?: number;
  category?: string | null;
} = {}): Promise<BlogListResult> {
  const pageSize = opts.pageSize ?? BLOG_PAGE_SIZE;
  try {
    const where = publishedPostWhere(opts.category);
    const total = await prisma.cmsPost.count({ where });
    const pagination = blogPagination(total, opts.page ?? 1, pageSize);
    const rows = await prisma.cmsPost.findMany({
      where,
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      skip: (pagination.page - 1) * pageSize,
      take: pageSize,
    });
    return { posts: rows.map((r) => toBlogPostSummary(r as BlogPostRow)), pagination };
  } catch {
    return { posts: [], pagination: blogPagination(0, 1, pageSize) };
  }
}

/** Distinct categories that actually have public posts, with counts. */
export async function listBlogCategories(): Promise<{ category: string; count: number }[]> {
  try {
    const grouped = await prisma.cmsPost.groupBy({
      by: ["category"],
      where: { ...publishedPostWhere(), category: { not: null } },
      _count: { _all: true },
    });
    return grouped
      .filter((g) => g.category)
      .map((g) => ({ category: g.category as string, count: g._count._all }))
      .sort((a, b) => a.category.localeCompare(b.category));
  } catch {
    return [];
  }
}

export async function getPublishedPostBySlug(slug: string): Promise<BlogPostFull | null> {
  try {
    const row = await prisma.cmsPost.findFirst({
      where: { slug, ...publishedPostWhere() },
    });
    return row ? toBlogPostFull(row as BlogPostRow) : null;
  } catch {
    return null;
  }
}

/** Related posts: same category first (newest first), filled with the
 *  newest other public posts. Real fields only — no scoring theatre. */
export async function getRelatedPosts(post: BlogPostSummary, limit = 3): Promise<BlogPostSummary[]> {
  try {
    const picked: BlogPostSummary[] = [];
    if (post.category) {
      const sameCategory = await prisma.cmsPost.findMany({
        where: { ...publishedPostWhere(post.category), slug: { not: post.slug } },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: limit,
      });
      picked.push(...sameCategory.map((r) => toBlogPostSummary(r as BlogPostRow)));
    }
    if (picked.length < limit) {
      const fill = await prisma.cmsPost.findMany({
        where: { ...publishedPostWhere(), slug: { notIn: [post.slug, ...picked.map((p) => p.slug)] } },
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: limit - picked.length,
      });
      picked.push(...fill.map((r) => toBlogPostSummary(r as BlogPostRow)));
    }
    return picked;
  } catch {
    return [];
  }
}

/** Newest public posts for the RSS feed + sitemap (slug/date only). */
export async function listPublishedPostsForFeed(limit = 20): Promise<BlogPostSummary[]> {
  try {
    const rows = await prisma.cmsPost.findMany({
      where: publishedPostWhere(),
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return rows.map((r) => toBlogPostSummary(r as BlogPostRow));
  } catch {
    return [];
  }
}

export async function listAllPublishedPostRefs(): Promise<{ slug: string; updatedAt: string }[]> {
  try {
    const rows = await prisma.cmsPost.findMany({
      where: publishedPostWhere(),
      select: { slug: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
    });
    return rows.map((r) => ({ slug: r.slug, updatedAt: r.updatedAt.toISOString() }));
  } catch {
    return [];
  }
}
