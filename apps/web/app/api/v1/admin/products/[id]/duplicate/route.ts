import { NextResponse } from "next/server";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { productInputSchema, validateCreateInput, type ProductInput } from "@/catalog/service";
import type { CatalogRepository } from "@/catalog/service";

// POST /api/v1/admin/products/[id]/duplicate — one-click product copy
// (Wave 13-3). Reads the full admin product and creates a DRAFT copy
// through the SAME create service as POST /api/v1/admin/products, so
// validation, the initial-stock ledger and search-index sync all
// behave identically to a hand-made product.
//   - slug: "<slug>-copy", then "-copy-2", "-copy-3", ... on collision.
//   - SKUs: "<sku>-COPY" with the same suffix progression, one shared
//     suffix per copy so a product's variant SKUs stay grouped.
//   - title gets " (কপি)" appended (both locales, so the copy is
//     recognisable wherever the title shows).
//   - Carried over: descriptions, category, brand, tags, SEO, images
//     (url + alt + order), variant attributes/prices/compare-at/cost,
//     isActive — and stock AS-IS (the create writes its initial-stock
//     ledger entries, exactly like a fresh product with that stock).
//   - NOT carried: barcodes. Barcode is a unique column — a physical
//     item's code cannot exist twice; copies get null so staff assign
//     fresh codes. Ratings/reviews are the source product's own and
//     are never copied.
// Permission: products.create (this is a create).

const SLUG_MAX = 200; // headroom under the column; schema enforces the pattern only
const SKU_MAX = 64; // variantInputSchema max

function withSuffix(base: string, suffix: string, max: number): string {
  return base.length + suffix.length > max ? base.slice(0, max - suffix.length) + suffix : base + suffix;
}

async function freeSlug(repo: CatalogRepository, baseSlug: string): Promise<string | null> {
  for (let n = 1; n <= 100; n += 1) {
    const suffix = n === 1 ? "-copy" : `-copy-${n}`;
    const candidate = withSuffix(baseSlug, suffix, SLUG_MAX);
    // eslint-disable-next-line no-await-in-loop -- sequential by design: each probe depends on the last
    if (!(await repo.slugExists(candidate))) return candidate;
  }
  return null;
}

async function freeSkuSuffix(repo: CatalogRepository, skus: string[]): Promise<string | null> {
  for (let n = 1; n <= 100; n += 1) {
    const suffix = n === 1 ? "-COPY" : `-COPY-${n}`;
    const candidates = skus.map((s) => withSuffix(s, suffix, SKU_MAX));
    // Truncation could theoretically merge two long SKUs that share a
    // prefix — a copy whose own SKUs collide is invalid, so move on.
    if (new Set(candidates).size !== candidates.length) continue;
    // eslint-disable-next-line no-await-in-loop -- sequential by design: each probe depends on the last
    const existing = await repo.skusExist(candidates);
    if (existing.length === 0) return suffix;
  }
  return null;
}

function copyTitle(title: string): string {
  const suffix = " (কপি)";
  const room = 255 - suffix.length; // titleBn/titleEn max in productInputSchema
  return (title.length > room ? title.slice(0, room) : title) + suffix;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  try {
    const repo = await getCatalogRepository();
    const source = await repo.getProductById(params.id);
    if (!source) return apiError("NOT_FOUND", "Product not found.", 404);
    const slug = await freeSlug(repo, source.slug);
    const skuSuffix = await freeSkuSuffix(
      repo,
      source.variants.map((v) => v.sku),
    );
    if (slug === null || skuSuffix === null) {
      return apiError(
        "COPY_LIMIT",
        "Could not find a free slug/SKU suffix for another copy of this product.",
        409,
      );
    }
    const input: ProductInput = {
      slug,
      titleBn: copyTitle(source.title.bn),
      titleEn: copyTitle(source.title.en),
      descriptionBn: source.description.bn,
      descriptionEn: source.description.en,
      categorySlug: source.categorySlug,
      brandName: source.brandName,
      status: "DRAFT",
      tags: [...source.tags],
      seoTitleBn: source.seoTitle?.bn ?? null,
      seoTitleEn: source.seoTitle?.en ?? null,
      seoDescriptionBn: source.seoDescription?.bn ?? null,
      seoDescriptionEn: source.seoDescription?.en ?? null,
      images: source.images.map((i) => ({
        url: i.url,
        altBn: i.altBn,
        altEn: i.altEn,
        sortOrder: i.sortOrder,
      })),
      variants: source.variants.map((v) => ({
        attributes: { ...v.attributes },
        sku: withSuffix(v.sku, skuSuffix, SKU_MAX),
        barcode: null,
        pricePoisha: v.pricePoisha,
        compareAtPoisha: v.compareAtPoisha,
        costPoisha: v.costPoisha,
        stock: v.stock,
        imageUrl: v.imageUrl,
        isActive: v.isActive,
      })),
    };
    const parsed = productInputSchema.safeParse(input);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The copied product data is invalid.",
            details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const payloadErrors = validateCreateInput(parsed.data);
    if (payloadErrors.length > 0) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: payloadErrors.join("; "), details: payloadErrors } },
        { status: 400 },
      );
    }
    const { product, ledgerEntries, ledgerPending } = await repo.createProduct(parsed.data, session.userId);
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.duplicate",
      entityId: product.id,
      beforeJson: { sourceId: source.id, sourceSlug: source.slug },
      afterJson: {
        slug: product.slug,
        status: product.status,
        variantCount: product.variants.length,
        ledgerEntries: ledgerEntries.length,
        ledgerPending,
      },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { product, sourceId: source.id } }, { status: 201 });
  } catch (error) {
    return handleServiceError(error);
  }
}
