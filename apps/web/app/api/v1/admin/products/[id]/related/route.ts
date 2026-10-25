import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";

// GET/PUT /api/v1/admin/products/[id]/related — the product's MANUAL
// related picks (Wave 14-2, doc 16 §P6). The PDP resolves these first
// (live ones only, in this order) and fills the rest from the same
// category — see src/catalog/related.ts.
//
// Storage: `relatedIds` is a plain String[] column on Product (no FK —
// picks may point at products in any status, and a pick that later
// gets deleted simply stops resolving publicly). The write therefore
// goes through Prisma directly, like taxonomy-admin / attributes-admin,
// instead of the catalog update schema.
//
// Validation (PUT): body { relatedIds: string[] } — at most 20 picks,
// duplicates collapsed (first occurrence wins), the product itself is
// refused, and every id must be an existing non-deleted product.

const RELATED_MAX = 20;

const putSchema = z.object({
  relatedIds: z.array(z.string().trim().min(1)).max(200),
});

interface RelatedSummary {
  id: string;
  titleBn: string;
  titleEn: string;
  slug: string;
  status: string;
}

// GET — current picks, resolved to summaries in pick order. A pick
// whose product no longer exists comes back as `missing: true` so the
// picker can show and remove it instead of silently dropping it.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.view")) {
    return apiError("FORBIDDEN", "Missing permission: products.view", 403);
  }
  try {
    const repo = await getCatalogRepository();
    const product = await repo.getProductById(params.id);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const picks: Array<RelatedSummary | { id: string; missing: true }> = [];
    for (const rid of product.relatedIds ?? []) {
      const rel = await repo.getProductById(rid).catch(() => null);
      picks.push(
        rel
          ? { id: rel.id, titleBn: rel.title.bn, titleEn: rel.title.en, slug: rel.slug, status: rel.status }
          : { id: rid, missing: true },
      );
    }
    return NextResponse.json({ data: { productId: product.id, relatedIds: product.relatedIds ?? [], picks } });
  } catch (error) {
    return handleServiceError(error);
  }
}

// PUT — replace the pick list wholesale (the picker always sends the
// full intended order, so replace semantics keep reorder trivial).
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.edit")) {
    return apiError("FORBIDDEN", "Missing permission: products.edit", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Related product data is invalid.",
          details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  // Collapse duplicates, preserving first-seen order.
  const relatedIds = [...new Set(parsed.data.relatedIds)];
  if (relatedIds.length > RELATED_MAX) {
    return apiError("VALIDATION_ERROR", `At most ${RELATED_MAX} related products.`, 400);
  }
  if (relatedIds.includes(params.id)) {
    return apiError("VALIDATION_ERROR", "A product cannot be related to itself.", 400);
  }
  try {
    const repo = await getCatalogRepository();
    const product = await repo.getProductById(params.id);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const missing: string[] = [];
    for (const rid of relatedIds) {
      const rel = await repo.getProductById(rid).catch(() => null);
      if (!rel) missing.push(rid);
    }
    if (missing.length > 0) {
      return apiError("VALIDATION_ERROR", `Related product(s) not found: ${missing.join(", ")}`, 400);
    }
    await prisma.product.update({
      where: { id: params.id },
      data: { relatedIds },
    });
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.edit",
      entityId: params.id,
      beforeJson: { relatedIds: product.relatedIds ?? [] },
      afterJson: { relatedIds },
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({ data: { productId: params.id, relatedIds } });
  } catch (error) {
    return handleServiceError(error);
  }
}
