import { NextResponse } from "next/server";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { productUpdateSchema } from "@/catalog/service";

// GET /api/v1/admin/products/[id]
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
    return NextResponse.json({ data: product });
  } catch (error) {
    return handleServiceError(error);
  }
}

// PATCH /api/v1/admin/products/[id] — update. If any variant price
// changes, `reason` is required (sensitive action products.price_change).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
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
  try {
    const repo = await getCatalogRepository();
    const before = await repo.getProductById(params.id);
    if (!before) return apiError("NOT_FOUND", "Product not found.", 404);
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
    try {
      const { indexProduct } = await import("@/catalog/indexer");
      await indexProduct(product);
    } catch {
      // Indexing is best-effort only.
    }
    return NextResponse.json({ data: product });
  } catch (error) {
    return handleServiceError(error);
  }
}
