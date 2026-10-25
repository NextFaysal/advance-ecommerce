import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { SLUG_REGEX, productInputSchema, slugify, validateCreateInput, type ProductInput } from "@/catalog/service";

/** slugify() keeps Bengali letters, but the create schema's SLUG_REGEX
 *  is ASCII-only — strip anything else so a Bangla/Chinese source
 *  title can never produce an un-creatable slug. */
function asciiSlug(value: string): string {
  return slugify(value)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

// POST /api/v1/admin/sourcing/create — Wave 15-3 (doc 16 §P7).
// Lands the merchant-EDITED sourcing preview as a product through the
// SAME create contract as POST /api/v1/admin/products (productInputSchema
// → validateCreateInput → repo.createProduct, one transaction, stock
// ledger, brand find-or-create). Differences from manual create:
//  - Status is FORCED to DRAFT — an imported product is never
//    published unseen; the merchant reviews it in the editor first.
//  - One default variant is built from the single price the merchant
//    confirmed (in poisha — any currency conversion happened in the
//    UI with the merchant's own rate, never a fabricated rate here).
//  - The source URL is stamped into both descriptions, so the
//    product's origin stays visible to staff and shoppers.
//  - Slug/SKU collisions get numeric suffixes instead of a hard 409 —
//    re-importing a similar item is normal sourcing work.
// Audit: products.sourcing_create with the source URL.
const bodySchema = z.object({
  sourceUrl: z.string().url().max(2048),
  titleBn: z.string().min(1).max(255),
  titleEn: z.string().min(1).max(255),
  descriptionBn: z.string().max(8000).optional(),
  descriptionEn: z.string().max(8000).optional(),
  categorySlug: z.string().min(1).max(128),
  brandName: z.string().max(128).nullable().optional(),
  /** Merchant-confirmed sell price in BDT poisha. */
  pricePoisha: z.number().int().min(0),
  compareAtPoisha: z.number().int().min(0).nullable().optional(),
  /** Merchant-confirmed unit cost in BDT poisha (e.g. from the landed-cost calculator). */
  costPoisha: z.number().int().min(0).nullable().optional(),
  sku: z.string().min(1).max(64).optional(),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  imageUrls: z.array(z.string().url().max(2048)).max(20).default([]),
  tags: z.array(z.string().max(64)).max(50).default([]),
});

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  await ensureDbFeatureFlags();
  if (!featureFlags.isFeatureEnabled("module.sourcing")) {
    return apiError("FEATURE_LOCKED", "সোর্সিং মডিউল বন্ধ আছে (module.sourcing OFF) — Admin > Settings > Feature Flags থেকে চালু করুন।", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsedBody = bodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Product data is invalid.",
          details: parsedBody.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  const input = parsedBody.data;
  try {
    const repo = await getCatalogRepository();

    // Slug: from the English title, suffixed until unique.
    let baseSlug = asciiSlug(input.titleEn) || asciiSlug(input.titleBn) || "imported-product";
    if (!SLUG_REGEX.test(baseSlug)) baseSlug = "imported-product";
    if (baseSlug.length > 120) baseSlug = baseSlug.slice(0, 120);
    let slug = baseSlug;
    for (let n = 2; (await repo.slugExists(slug)) && n < 100; n++) slug = `${baseSlug}-${n}`;

    // SKU: merchant-given or generated from the source host + time;
    // suffixed until unique (same rule as the slug).
    let hostPart = "src";
    try {
      hostPart = slugify(new URL(input.sourceUrl).hostname.replace(/^www\./, "").split(".")[0] ?? "src") || "src";
    } catch {
      /* keep default */
    }
    let sku = (input.sku ?? `SRC-${hostPart.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`).slice(0, 64);
    if ((await repo.skusExist([sku])).length > 0) {
      const stem = sku.slice(0, 58);
      for (let n = 2; n < 100; n++) {
        const candidate = `${stem}-${n}`;
        if ((await repo.skusExist([candidate])).length === 0) {
          sku = candidate;
          break;
        }
      }
    }

    const sourceNoteBn = `উৎস: ${input.sourceUrl}`;
    const sourceNoteEn = `Source: ${input.sourceUrl}`;
    const descriptionBn = [input.descriptionBn?.trim() || input.titleBn, "", sourceNoteBn].join("\n");
    const descriptionEn = [input.descriptionEn?.trim() || input.titleEn, "", sourceNoteEn].join("\n");

    const payload: ProductInput = {
      slug,
      type: "SIMPLE",
      digitalFiles: [],
      bundleComponents: [],
      titleBn: input.titleBn,
      titleEn: input.titleEn,
      descriptionBn,
      descriptionEn,
      categorySlug: input.categorySlug,
      brandName: input.brandName ?? null,
      status: "DRAFT",
      tags: input.tags,
      relatedIds: [],
      images: input.imageUrls.map((url, i) => ({
        url,
        altBn: input.titleBn,
        altEn: input.titleEn,
        sortOrder: i,
      })),
      variants: [
        {
          attributes: {},
          sku,
          pricePoisha: input.pricePoisha,
          compareAtPoisha: input.compareAtPoisha ?? null,
          costPoisha: input.costPoisha ?? null,
          stock: input.stock,
          isActive: true,
        },
      ],
    };
    const parsedPayload = productInputSchema.safeParse(payload);
    if (!parsedPayload.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Product data is invalid.",
            details: parsedPayload.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
          },
        },
        { status: 400 },
      );
    }
    const payloadErrors = validateCreateInput(parsedPayload.data);
    if (payloadErrors.length > 0) {
      return apiError("VALIDATION_ERROR", payloadErrors.join("; "), 400);
    }
    const { product, ledgerEntries, ledgerPending } = await repo.createProduct(parsedPayload.data, session.userId);
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.sourcing_create",
      entityId: product.id,
      afterJson: {
        slug: product.slug,
        status: product.status,
        sourceUrl: input.sourceUrl,
        imageCount: input.imageUrls.length,
        ledgerEntries: ledgerEntries.length,
        ledgerPending,
      },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { product, ledgerEntries, ledgerPending } }, { status: 201 });
  } catch (error) {
    return handleServiceError(error);
  }
}
