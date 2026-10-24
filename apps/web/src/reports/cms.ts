// CMS service — Step 29 (page/blog CRUD, menu, SEO/redirect).
// DB-backed (Prisma): kind "page" -> CmsPage table, kind "post" ->
// CmsPost table; slug renames record an SeoRedirect row; deletes are
// soft (deletedAt). Contract notes — fields the input schema accepts
// but the schema has no column for are NOT persisted: scheduledAt
// (reads return null; the SCHEDULED status itself persists) and
// seo.canonical. CmsPage has no category/tags columns, so pages read
// back with tags: [] and no category (posts persist both).
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");
export const seoSchema = z.object({
  title: z.string().max(200).default(""),
  description: z.string().max(500).default(""),
  canonical: z.string().optional(),
});
export const pageInputSchema = z.object({
  kind: z.enum(["page", "post"]),
  slug: slugSchema,
  titleBn: z.string().min(1),
  titleEn: z.string().min(1),
  bodyBn: z.string().default(""),
  bodyEn: z.string().default(""),
  status: z.enum(["draft", "published", "scheduled"]),
  scheduledAt: z.string().nullable().default(null),
  category: z.string().optional(),
  tags: z.array(z.string()).default([]),
  seo: seoSchema.default({ title: "", description: "" }),
});
export type PageInput = z.infer<typeof pageInputSchema>;
export interface CmsPage extends PageInput { id: string; createdAt: string; updatedAt: string; }

type CmsKind = PageInput["kind"];
type CmsStatusDb = "DRAFT" | "PUBLISHED" | "SCHEDULED";

const STATUS_TO_DB: Record<PageInput["status"], CmsStatusDb> = {
  draft: "DRAFT",
  published: "PUBLISHED",
  scheduled: "SCHEDULED",
};
const STATUS_FROM_DB: Record<string, PageInput["status"]> = {
  DRAFT: "draft",
  PUBLISHED: "published",
  SCHEDULED: "scheduled",
};

interface CmsRow {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string | null;
  bodyBn: string;
  bodyEn: string | null;
  status: string;
  seoTitle: string | null;
  seoDescription: string | null;
  category?: string | null;
  tags?: string[];
  createdAt: Date;
  updatedAt: Date;
}

function rowToPage(kind: CmsKind, row: CmsRow): CmsPage {
  return {
    id: row.id,
    kind,
    slug: row.slug,
    titleBn: row.titleBn,
    titleEn: row.titleEn ?? "",
    bodyBn: row.bodyBn,
    bodyEn: row.bodyEn ?? "",
    status: STATUS_FROM_DB[row.status] ?? "draft",
    scheduledAt: null, // no column in the schema — see header note
    category: row.category ?? undefined,
    tags: row.tags ?? [],
    seo: { title: row.seoTitle ?? "", description: row.seoDescription ?? "" },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export class CmsStore {
  async create(input: PageInput): Promise<CmsPage> {
    const clash = input.kind === "page"
      ? await prisma.cmsPage.findFirst({ where: { slug: input.slug, deletedAt: null } })
      : await prisma.cmsPost.findFirst({ where: { slug: input.slug, deletedAt: null } });
    if (clash) throw new Error("slug_already_exists");
    const status = STATUS_TO_DB[input.status];
    const publishedAt = input.status === "published" ? new Date() : null;
    try {
      if (input.kind === "page") {
        const row = await prisma.cmsPage.create({
          data: {
            slug: input.slug, titleBn: input.titleBn, titleEn: input.titleEn || null,
            bodyBn: input.bodyBn, bodyEn: input.bodyEn || null, status,
            seoTitle: input.seo.title || null, seoDescription: input.seo.description || null,
            publishedAt,
          },
        });
        return rowToPage("page", row);
      }
      const row = await prisma.cmsPost.create({
        data: {
          slug: input.slug, titleBn: input.titleBn, titleEn: input.titleEn || null,
          bodyBn: input.bodyBn, bodyEn: input.bodyEn || null, status,
          category: input.category ?? null, tags: input.tags,
          seoTitle: input.seo.title || null, seoDescription: input.seo.description || null,
          publishedAt,
        },
      });
      return rowToPage("post", row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  async update(id: string, input: PageInput): Promise<CmsPage> {
    const status = STATUS_TO_DB[input.status];
    // Locate the row in either table (ids are unique across both).
    const pageRow = await prisma.cmsPage.findFirst({ where: { id, deletedAt: null } });
    const existing: { kind: CmsKind; row: CmsRow } | null = pageRow
      ? { kind: "page", row: pageRow }
      : await (async () => {
          const postRow = await prisma.cmsPost.findFirst({ where: { id, deletedAt: null } });
          return postRow ? { kind: "post" as CmsKind, row: postRow as CmsRow } : null;
        })();
    if (!existing) throw new Error("page_not_found");
    if (existing.row.slug !== input.slug) {
      // SEO redirect: the old slug keeps working via the redirect table.
      await prisma.seoRedirect.upsert({
        where: { fromPath: existing.row.slug },
        create: { fromPath: existing.row.slug, toPath: input.slug },
        update: { toPath: input.slug },
      });
    }
    const publishedAt = input.status === "published" ? new Date() : null;
    try {
      if (existing.kind === "page") {
        const row = await prisma.cmsPage.update({
          where: { id },
          data: {
            slug: input.slug, titleBn: input.titleBn, titleEn: input.titleEn || null,
            bodyBn: input.bodyBn, bodyEn: input.bodyEn || null, status,
            seoTitle: input.seo.title || null, seoDescription: input.seo.description || null,
            publishedAt,
          },
        });
        return rowToPage("page", row);
      }
      const row = await prisma.cmsPost.update({
        where: { id },
        data: {
          slug: input.slug, titleBn: input.titleBn, titleEn: input.titleEn || null,
          bodyBn: input.bodyBn, bodyEn: input.bodyEn || null, status,
          category: input.category ?? null, tags: input.tags,
          seoTitle: input.seo.title || null, seoDescription: input.seo.description || null,
          publishedAt,
        },
      });
      return rowToPage("post", row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  async get(id: string): Promise<CmsPage | undefined> {
    const pageRow = await prisma.cmsPage.findFirst({ where: { id, deletedAt: null } });
    if (pageRow) return rowToPage("page", pageRow);
    const postRow = await prisma.cmsPost.findFirst({ where: { id, deletedAt: null } });
    return postRow ? rowToPage("post", postRow) : undefined;
  }

  async list(kind?: CmsKind): Promise<CmsPage[]> {
    const out: CmsPage[] = [];
    if (kind !== "post") {
      const rows = await prisma.cmsPage.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" } });
      out.push(...rows.map((r) => rowToPage("page", r)));
    }
    if (kind !== "page") {
      const rows = await prisma.cmsPost.findMany({ where: { deletedAt: null }, orderBy: { updatedAt: "desc" } });
      out.push(...rows.map((r) => rowToPage("post", r)));
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** Soft delete (deletedAt) — the row stays in the DB. */
  async delete(id: string): Promise<boolean> {
    const page = await prisma.cmsPage.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    if (page.count > 0) return true;
    const post = await prisma.cmsPost.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });
    return post.count > 0;
  }

  async resolveRedirect(slug: string): Promise<string | null> {
    const row = await prisma.seoRedirect.findUnique({ where: { fromPath: slug } });
    return row?.toPath ?? null;
  }

  async listRedirects(): Promise<{ from: string; to: string }[]> {
    const rows = await prisma.seoRedirect.findMany({ orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ from: r.fromPath, to: r.toPath }));
  }
}
/** Shared DB-backed singleton for the CMS API routes + admin content page. */
export const cmsStore = new CmsStore();

// Menu builder stub: ordered items, max one level of nesting for v1 CMS.
// (Menu persistence is not part of the CMS tables; this stays a stub.)
export const menuItemSchema = z.object({
  labelBn: z.string().min(1), labelEn: z.string().min(1), href: z.string().min(1),
  children: z.array(z.object({ labelBn: z.string().min(1), labelEn: z.string().min(1), href: z.string().min(1) })).default([]),
});
export type MenuItem = z.infer<typeof menuItemSchema>;
export function buildMenu(items: MenuItem[]): MenuItem[] { return items.map((i) => ({ ...i })); }
