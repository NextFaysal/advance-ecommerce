/**
 * Taxonomy admin — Category + Brand data access (Wave P2a, doc 16 §P2).
 *
 * Until now categories and brands had NO admin surface at all: categories
 * existed only via seed, brands only via find-or-create inside product
 * create (service.ts resolveBrandId). This module is the data layer for
 * the new /admin/categories + /admin/brands pages and the
 * /api/v1/admin/{categories,brands} routes. It deliberately does NOT
 * live in service.ts (owned by the catalog service) — it talks to
 * Prisma directly, like src/newsletter/store-db.ts and
 * src/marketing/repository.ts do for their modules.
 *
 * Delete semantics (chosen here, surfaced in the API + report):
 * both models carry `deletedAt` and every read path in the codebase
 * (service.ts getCategories, resolveCategoryId, resolveBrandId) filters
 * `deletedAt: null`, so deletes are SOFT (deletedAt = now). A row that
 * still has products (either model) or child categories (Category) is
 * REFUSED with 409 — the admin retires it instead via isActive=false
 * (Category) which hides it from the storefront while products exist.
 * Brand has no isActive column, so a referenced brand simply cannot be
 * deleted until its products are reassigned — same rule other modules
 * use for referenced rows.
 *
 * Slugs are globally unique in the schema INCLUDING soft-deleted rows,
 * so uniqueness checks look at every row, not just live ones.
 *
 * Brand note: the schema has NO description column (name/slug/logoUrl
 * only) and this wave ships no migration, so brand descriptions are
 * not part of the API yet — a schema gap, flagged in the wave report.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import { slugify } from "./service";

export class TaxonomyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "TaxonomyError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code?: string }).code === "P2002";
}

/** P2002 backstop → the same 409 shape the pre-checks produce. */
export function rethrowTaxonomy(e: unknown): never {
  if (e instanceof TaxonomyError) throw e;
  if (isUniqueViolation(e)) {
    throw new TaxonomyError("SLUG_TAKEN", "Slug already in use.", 409);
  }
  throw e;
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

const optionalUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https?:\/\//i.test(v), "Must be an http(s) URL or empty.")
  .optional();

export const categoryCreateSchema = z.object({
  nameBn: z.string().trim().min(1, "Bangla name is required.").max(200),
  nameEn: z.string().trim().min(1, "English name is required.").max(200),
  slug: z.string().trim().max(160).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
  imageUrl: optionalUrl,
  sortOrder: z.number().int().min(-10000).max(10000).optional(),
  isActive: z.boolean().optional(),
});
export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>;

export const categoryUpdateSchema = categoryCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Nothing to update." },
);
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>;

export const brandCreateSchema = z.object({
  name: z.string().trim().min(1, "Brand name is required.").max(200),
  slug: z.string().trim().max(160).optional(),
  logoUrl: optionalUrl,
});
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;

export const brandUpdateSchema = brandCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: "Nothing to update." },
);
export type BrandUpdateInput = z.infer<typeof brandUpdateSchema>;

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface AdminCategory {
  id: string;
  slug: string;
  nameBn: string;
  nameEn: string;
  parentId: string | null;
  parentNameBn: string | null;
  parentNameEn: string | null;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  /** Non-deleted products in ANY status — the admin truth for delete guards. */
  productCount: number;
  childCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminBrand {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
}

const categoryInclude = {
  parent: { select: { nameBn: true, nameEn: true } },
  _count: {
    select: {
      products: { where: { deletedAt: null } },
      children: { where: { deletedAt: null } },
    },
  },
} as const;

type CategoryRow = Awaited<ReturnType<typeof findCategoryRow>>;
async function findCategoryRow(id: string) {
  return prisma.category.findFirst({
    where: { id, deletedAt: null },
    include: categoryInclude,
  });
}

function mapCategory(row: NonNullable<CategoryRow>): AdminCategory {
  return {
    id: row.id,
    slug: row.slug,
    nameBn: row.nameBn,
    nameEn: row.nameEn,
    parentId: row.parentId,
    parentNameBn: row.parent?.nameBn ?? null,
    parentNameEn: row.parent?.nameEn ?? null,
    imageUrl: row.imageUrl,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount: row._count.products,
    childCount: row._count.children,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapBrand(row: {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { products: number };
}): AdminBrand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logoUrl,
    productCount: row._count.products,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export async function listCategoriesAdmin(): Promise<AdminCategory[]> {
  const rows = await prisma.category.findMany({
    where: { deletedAt: null },
    include: categoryInclude,
    orderBy: [{ sortOrder: "asc" }, { nameEn: "asc" }],
  });
  return rows.map(mapCategory);
}

export async function getCategoryAdmin(id: string): Promise<AdminCategory | null> {
  const row = await findCategoryRow(id);
  return row ? mapCategory(row) : null;
}

function normalizeSlug(raw: string | undefined, fallbackName: string): string {
  const slug = slugify(raw && raw.trim() !== "" ? raw : fallbackName);
  if (!slug) {
    throw new TaxonomyError("INVALID_SLUG", "Slug could not be generated — provide one explicitly.", 400);
  }
  return slug;
}

async function assertCategorySlugFree(slug: string, excludeId?: string): Promise<void> {
  const existing = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== excludeId) {
    throw new TaxonomyError("SLUG_TAKEN", `Category slug already in use: ${slug}`, 409);
  }
}

async function assertValidParent(parentId: string, selfId?: string): Promise<void> {
  // Walk up from the proposed parent: it must exist, be live, and must
  // not be the category itself or one of its descendants (cycle).
  let cursor: string | null = parentId;
  let hops = 0;
  while (cursor) {
    if (selfId && cursor === selfId) {
      throw new TaxonomyError(
        "INVALID_PARENT",
        "A category cannot be its own parent or sit under its own descendant.",
        400,
      );
    }
    if (++hops > 50) {
      throw new TaxonomyError("INVALID_PARENT", "Category tree is too deep or cyclic.", 400);
    }
    const row: { id: string; parentId: string | null } | null = await prisma.category.findFirst({
      where: { id: cursor, deletedAt: null },
      select: { id: true, parentId: true },
    });
    if (!row) {
      throw new TaxonomyError("PARENT_NOT_FOUND", `Parent category not found: ${parentId}`, 400);
    }
    cursor = row.parentId;
  }
}

export async function createCategoryAdmin(input: CategoryCreateInput): Promise<AdminCategory> {
  const slug = normalizeSlug(input.slug, input.nameEn);
  await assertCategorySlugFree(slug);
  const parentId = input.parentId ?? null;
  if (parentId) await assertValidParent(parentId);
  try {
    const row = await prisma.category.create({
      data: {
        slug,
        nameBn: input.nameBn,
        nameEn: input.nameEn,
        parentId,
        imageUrl: input.imageUrl ? input.imageUrl : null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
      include: categoryInclude,
    });
    return mapCategory(row);
  } catch (e) {
    rethrowTaxonomy(e);
  }
}

export async function updateCategoryAdmin(id: string, input: CategoryUpdateInput): Promise<AdminCategory> {
  const existing = await findCategoryRow(id);
  if (!existing) throw new TaxonomyError("NOT_FOUND", "Category not found.", 404);
  const data: {
    nameBn?: string;
    nameEn?: string;
    slug?: string;
    parentId?: string | null;
    imageUrl?: string | null;
    sortOrder?: number;
    isActive?: boolean;
  } = {};
  if (input.nameBn !== undefined) data.nameBn = input.nameBn;
  if (input.nameEn !== undefined) data.nameEn = input.nameEn;
  // Slug changes only when explicitly sent — renaming a category never
  // silently re-slugs it (product category resolution is slug-based).
  if (input.slug !== undefined) {
    const slug = normalizeSlug(input.slug, input.nameEn ?? existing.nameEn);
    await assertCategorySlugFree(slug, id);
    data.slug = slug;
  }
  if (input.parentId !== undefined) {
    const parentId = input.parentId;
    if (parentId) await assertValidParent(parentId, id);
    data.parentId = parentId;
  }
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl ? input.imageUrl : null;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  try {
    const row = await prisma.category.update({ where: { id }, data, include: categoryInclude });
    return mapCategory(row);
  } catch (e) {
    rethrowTaxonomy(e);
  }
}

export async function deleteCategoryAdmin(id: string): Promise<{ id: string; retired: true }> {
  const existing = await findCategoryRow(id);
  if (!existing) throw new TaxonomyError("NOT_FOUND", "Category not found.", 404);
  if (existing._count.products > 0) {
    throw new TaxonomyError(
      "CATEGORY_HAS_PRODUCTS",
      `This category still has ${existing._count.products} product(s). Move the products first, or retire the category by turning it off (isActive) instead of deleting.`,
      409,
    );
  }
  if (existing._count.children > 0) {
    throw new TaxonomyError(
      "CATEGORY_HAS_CHILDREN",
      `This category still has ${existing._count.children} sub-categor${existing._count.children === 1 ? "y" : "ies"}. Delete or re-parent them first.`,
      409,
    );
  }
  await prisma.category.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  return { id, retired: true };
}

/* ------------------------------------------------------------------ */
/* Brands                                                              */
/* ------------------------------------------------------------------ */

const brandInclude = {
  _count: { select: { products: { where: { deletedAt: null } } } },
} as const;

export async function listBrandsAdmin(): Promise<AdminBrand[]> {
  const rows = await prisma.brand.findMany({
    where: { deletedAt: null },
    include: brandInclude,
    orderBy: [{ name: "asc" }],
  });
  return rows.map(mapBrand);
}

export async function getBrandAdmin(id: string): Promise<AdminBrand | null> {
  const row = await prisma.brand.findFirst({
    where: { id, deletedAt: null },
    include: brandInclude,
  });
  return row ? mapBrand(row) : null;
}

async function assertBrandFree(name: string, slug: string, excludeId?: string): Promise<void> {
  const byName = await prisma.brand.findUnique({ where: { name }, select: { id: true } });
  if (byName && byName.id !== excludeId) {
    throw new TaxonomyError("NAME_TAKEN", `Brand name already in use: ${name}`, 409);
  }
  const bySlug = await prisma.brand.findUnique({ where: { slug }, select: { id: true } });
  if (bySlug && bySlug.id !== excludeId) {
    throw new TaxonomyError("SLUG_TAKEN", `Brand slug already in use: ${slug}`, 409);
  }
}

export async function createBrandAdmin(input: BrandCreateInput): Promise<AdminBrand> {
  const slug = normalizeSlug(input.slug, input.name);
  await assertBrandFree(input.name, slug);
  try {
    const row = await prisma.brand.create({
      data: { name: input.name, slug, logoUrl: input.logoUrl ? input.logoUrl : null },
      include: brandInclude,
    });
    return mapBrand(row);
  } catch (e) {
    rethrowTaxonomy(e);
  }
}

export async function updateBrandAdmin(id: string, input: BrandUpdateInput): Promise<AdminBrand> {
  const existing = await prisma.brand.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new TaxonomyError("NOT_FOUND", "Brand not found.", 404);
  const name = input.name ?? existing.name;
  const slug = input.slug !== undefined ? normalizeSlug(input.slug, name) : existing.slug;
  if (input.name !== undefined || input.slug !== undefined) {
    await assertBrandFree(name, slug, id);
  }
  const data: { name?: string; slug?: string; logoUrl?: string | null } = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.slug !== undefined) data.slug = slug;
  if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl ? input.logoUrl : null;
  try {
    const row = await prisma.brand.update({ where: { id }, data, include: brandInclude });
    return mapBrand(row);
  } catch (e) {
    rethrowTaxonomy(e);
  }
}

export async function deleteBrandAdmin(id: string): Promise<{ id: string; retired: true }> {
  const existing = await prisma.brand.findFirst({
    where: { id, deletedAt: null },
    include: brandInclude,
  });
  if (!existing) throw new TaxonomyError("NOT_FOUND", "Brand not found.", 404);
  if (existing._count.products > 0) {
    throw new TaxonomyError(
      "BRAND_HAS_PRODUCTS",
      `This brand still has ${existing._count.products} product(s). Reassign those products to another brand first.`,
      409,
    );
  }
  await prisma.brand.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id, retired: true };
}
