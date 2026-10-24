// CMS service — Agent 10, Step 29 (page/blog CRUD outline, menu, SEO/redirect).
// In-memory store; Prisma swap pending generate (same pattern as inventory).
import { z } from "zod";

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

export class CmsStore {
  private pages = new Map<string, CmsPage>();
  private redirects = new Map<string, string>(); // oldSlug -> newSlug
  create(input: PageInput): CmsPage {
    for (const p of this.pages.values()) if (p.slug === input.slug && p.kind === input.kind) throw new Error("slug_already_exists");
    const now = new Date().toISOString();
    const page: CmsPage = { ...input, id: `pg_${Date.now()}`, createdAt: now, updatedAt: now };
    this.pages.set(page.id, page);
    return page;
  }
  update(id: string, input: PageInput): CmsPage {
    const existing = this.pages.get(id);
    if (!existing) throw new Error("page_not_found");
    if (existing.slug !== input.slug) this.redirects.set(existing.slug, input.slug); // SEO redirect stub: old URL keeps working via redirect map.
    const updated: CmsPage = { ...existing, ...input, updatedAt: new Date().toISOString() };
    this.pages.set(id, updated);
    return updated;
  }
  get(id: string) { return this.pages.get(id); }
  list(kind?: "page" | "post") { return [...this.pages.values()].filter((p) => !kind || p.kind === kind); }
  delete(id: string) { return this.pages.delete(id); } // soft-delete is DB behaviour (deletedAt); in-memory hard delete is a stub note.
  resolveRedirect(slug: string) { return this.redirects.get(slug) ?? null; }
  listRedirects() { return [...this.redirects.entries()].map(([from, to]) => ({ from, to })); }
}
/** Shared in-memory singleton for the CMS API routes (stub persistence). */
export const cmsStore = new CmsStore();

// Menu builder stub: ordered items, max one level of nesting for v1 CMS.
export const menuItemSchema = z.object({
  labelBn: z.string().min(1), labelEn: z.string().min(1), href: z.string().min(1),
  children: z.array(z.object({ labelBn: z.string().min(1), labelEn: z.string().min(1), href: z.string().min(1) })).default([]),
});
export type MenuItem = z.infer<typeof menuItemSchema>;
export function buildMenu(items: MenuItem[]): MenuItem[] { return items.map((i) => ({ ...i })); }
