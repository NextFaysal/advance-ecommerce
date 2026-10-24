import { NextResponse } from "next/server";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { stripCostPrice, hasPermission } from "@/lib/rbac";
import { productInputSchema, validateCreateInput } from "@/catalog/service";

// GET /api/v1/admin/products — admin list. Cost price returned ONLY
// when the caller has products.edit_cost_price; otherwise stripped.
// Status: ?status=DRAFT|ACTIVE|ARCHIVED filters; ?status=ALL — and no
// status param at all — returns every status, because an admin list
// that hides drafts by default makes them unmanageable. (The public
// storefront list is a different route and stays ACTIVE-only.)
export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.view")) {
    return apiError("FORBIDDEN", "Missing permission: products.view", 403);
  }
  try {
    const url = new URL(req.url);
    const repo = await getCatalogRepository();
    const result = await repo.listProducts({
      query: url.searchParams.get("q") ?? undefined,
      categorySlug: url.searchParams.get("category") ?? undefined,
      status: url.searchParams.get("status") ?? "ALL",
      page: Number(url.searchParams.get("page") ?? "1") || 1,
      pageSize: Number(url.searchParams.get("pageSize") ?? "20") || 20,
    });
    const canSeeCost = hasPermission(session.permissions, "products.edit_cost_price");
    const products = result.products.map((p) => ({
      ...p,
      variants: canSeeCost ? p.variants : p.variants.map((v) => stripCostPrice(v, session.permissions)),
    }));
    return NextResponse.json({
      data: products,
      meta: { total: result.total, page: result.page, pageSize: result.pageSize },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

// POST /api/v1/admin/products — admin create.
// Zod validated. Slug unique (checked, DB unique is backstop).
// Duplicate SKUs in payload rejected. Audit written. Initial stock
// goes through ledger entries only — see service.ts. Search-index
// sync happens inside the repository (fire-and-forget, never fails
// the create) — see PrismaCatalogRepository.createProduct.
export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = productInputSchema.safeParse(body);
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
  const payloadErrors = validateCreateInput(parsed.data);
  if (payloadErrors.length > 0) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: payloadErrors.join("; "), details: payloadErrors } },
      { status: 400 },
    );
  }
  try {
    const repo = await getCatalogRepository();
    if (await repo.slugExists(parsed.data.slug)) {
      return apiError("SLUG_TAKEN", `Slug already in use: ${parsed.data.slug}`, 409);
    }
    const existingSkus = await repo.skusExist(parsed.data.variants.map((v) => v.sku));
    if (existingSkus.length > 0) {
      return apiError("SKU_TAKEN", `SKU already exists: ${existingSkus.join(", ")}`, 409);
    }
    const { product, ledgerEntries, ledgerPending } = await repo.createProduct(parsed.data, session.userId);
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.create",
      entityId: product.id,
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
    return NextResponse.json(
      { data: { product, ledgerEntries, ledgerPending } },
      { status: 201 },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
