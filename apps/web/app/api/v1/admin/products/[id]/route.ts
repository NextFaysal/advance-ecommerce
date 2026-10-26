import { NextResponse } from "next/server";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { canSeeCostPrices, maskCatalogProduct } from "@/lib/cost-masking";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { productUpdateSchema } from "@/catalog/service";
import { productTypePayloadLocked } from "@/catalog/product-types";

// GET /api/v1/admin/products/[id]
// Cost masking (ADV-27): variant costs are returned only to holders
// of products.edit_cost_price; everyone else gets costPoisha: null
// (server-side — the value never leaves in the payload) plus
// meta.costMasked so the UI can render "—" and say why.
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
    const canSeeCost = canSeeCostPrices(session.permissions);
    return NextResponse.json({
      data: maskCatalogProduct(product, session.permissions),
      meta: { costMasked: !canSeeCost },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

// PATCH /api/v1/admin/products/[id] — update. If any variant price
// changes, `reason` is required (sensitive action products.price_change).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  await ensureDbFeatureFlags();
  if (!hasPermission(session.permissions, "products.edit")) {
    return apiError("FORBIDDEN", "Missing permission: products.edit", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = productUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Product data is invalid.",
          details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  // Wave 15: product-type payloads require module.product_types.
  if (productTypePayloadLocked(parsed.data)) {
    return apiError(
      "FEATURE_LOCKED",
      "Product types are locked for this install (module.product_types is OFF).",
      403,
    );
  }
  try {
    const repo = await getCatalogRepository();
    const before = await repo.getProductById(params.id);
    if (!before) return apiError("NOT_FOUND", "Product not found.", 404);
    // Cost preservation (ADV-27): updateProduct replaces the variant
    // set, writing costPoisha verbatim (null = no cost). A caller
    // WITHOUT products.edit_cost_price reads costs masked (null) —
    // if their payload were written back as-is, every edit would
    // wipe the recorded costs. So for those callers the EXISTING
    // cost (matched by SKU; new variants have none) is substituted
    // here, server-side, before the update runs.
    if (!canSeeCostPrices(session.permissions) && parsed.data.variants !== undefined) {
      const existingCostBySku = new Map(before.variants.map((v) => [v.sku, v.costPoisha ?? null]));
      parsed.data = {
        ...parsed.data,
        variants: parsed.data.variants.map((v) => ({
          ...v,
          costPoisha: existingCostBySku.get(v.sku) ?? null,
        })),
      };
    }
    if (parsed.data.slug && parsed.data.slug !== before.slug && (await repo.slugExists(parsed.data.slug, params.id))) {
      return apiError("SLUG_TAKEN", `Slug already in use: ${parsed.data.slug}`, 409);
    }
    const { product } = await repo.updateProduct(params.id, parsed.data, session.userId);
    const priceChanged =
      parsed.data.variants !== undefined &&
      parsed.data.variants.some((v) =>
        before.variants.some((ev) => ev.sku === v.sku && ev.pricePoisha !== v.pricePoisha),
      );
    await writeCatalogAudit({
      actorId: session.userId,
      action: priceChanged ? "products.price_change" : "products.edit",
      entityId: product.id,
      beforeJson: { slug: before.slug, status: before.status },
      afterJson: { slug: product.slug, status: product.status },
      reason: priceChanged ? parsed.data.reason : undefined,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    // Search-index sync is owned by the repository layer
    // (PrismaCatalogRepository.updateProduct, fire-and-forget).
    // Response masked like the GET (ADV-27).
    return NextResponse.json({
      data: maskCatalogProduct(product, session.permissions),
      meta: { costMasked: !canSeeCostPrices(session.permissions) },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

// DELETE /api/v1/admin/products/[id] — SOFT delete only (the repository
// sets deletedAt on the product and its live variants; a hard delete is
// forbidden because order history references variants). `reason` is
// required: products.delete is a sensitive action in the audit lib,
// same rule as products.price_change on PATCH. Deleting an already
// soft-deleted product is an idempotent success (alreadyDeleted: true),
// never an error; a missing product is a 404.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.delete")) {
    return apiError("FORBIDDEN", "Missing permission: products.delete", 403);
  }
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason === "") {
    return apiError("REASON_REQUIRED", "A reason is required to delete a product (products.delete).", 400);
  }
  try {
    const repo = await getCatalogRepository();
    const result = await repo.deleteProduct(params.id);
    if (!result) return apiError("NOT_FOUND", "Product not found.", 404);
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.delete",
      entityId: result.product.id,
      beforeJson: { slug: result.product.slug, status: result.product.status },
      afterJson: { deleted: true, alreadyDeleted: result.alreadyDeleted },
      reason,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
    // Search-index removal is owned by the repository layer
    // (PrismaCatalogRepository.deleteProduct, fire-and-forget).
    return NextResponse.json({
      data: {
        id: result.product.id,
        slug: result.product.slug,
        deleted: true,
        alreadyDeleted: result.alreadyDeleted,
      },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
