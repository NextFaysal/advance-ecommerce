import { NextResponse } from "next/server";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
  writeCatalogAudit,
} from "@/catalog/api";
import { stripCostPrice, hasPermission } from "@/lib/rbac";
import type { Product } from "@/catalog/types";

// GET /api/v1/admin/products/export — products CSV export, one row
// per variant. Mirrors the codebase's export convention (audit-log +
// call-center report exports): a `reason` query param is MANDATORY,
// the CSV carries a watermark header (exported-by, exported-at
// Asia/Dhaka, reason, filters), and the export itself is written to
// the AuditLog (action "products.export").
//
// Permission mirrors the products LIST (products.view). Cost follows
// the list route's field rule too: cost_taka is filled only when the
// caller holds products.edit_cost_price, otherwise the cells stay
// empty (stripped via stripCostPrice, never faked as 0).
//
// Filters mirror the list route: ?q=, ?category= (slug), ?status=
// (specific status, or ALL / omitted = every status, as the admin
// list defaults). The repository applies text/category filters per
// page, so this handler walks every page of the status-filtered set
// (pageSize is capped at 100 in the repository) and accumulates the
// filtered products — the union is the full filtered set.

const PAGE_SIZE = 100;
const MAX_PAGES = 500; // hard stop: 50,000 products — far beyond any current catalog

function csvCell(value: string | null): string {
  if (value === null) return "";
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function dhakaTimestamp(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Integer poisha → taka string with exactly 2 decimals (display only). */
function poishaToTaka(poisha: number | null | undefined): string {
  if (poisha === null || poisha === undefined) return "";
  return (poisha / 100).toFixed(2);
}

function attributesSummary(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

const CSV_HEADER = [
  "title_bn",
  "title_en",
  "slug",
  "status",
  "category_slug",
  "brand_name",
  "variant_sku",
  "barcode",
  "attributes",
  "price_taka",
  "compare_at_taka",
  "cost_taka",
  "stock",
  "rating_average",
  "review_count",
  "created_at",
  "updated_at",
].join(",");

function productRows(product: Product): string[] {
  // A product with no variants still gets one row (variant cells
  // empty) so the export never silently drops a catalog entry.
  const variants = product.variants.length > 0 ? product.variants : [null];
  return variants.map((v) =>
    [
      product.title.bn,
      product.title.en,
      product.slug,
      product.status,
      product.categorySlug,
      product.brandName,
      v?.sku ?? null,
      v?.barcode ?? null,
      v ? attributesSummary(v.attributes) : null,
      v ? poishaToTaka(v.pricePoisha) : null,
      v ? poishaToTaka(v.compareAtPoisha) : null,
      v ? poishaToTaka(v.costPoisha) : null,
      v ? String(v.stock) : null,
      product.ratingAverage === null ? null : String(product.ratingAverage),
      String(product.reviewCount),
      product.createdAt,
      product.updatedAt,
    ]
      .map((cell) => csvCell(cell === null ? null : String(cell)))
      .join(","),
  );
}

export async function GET(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.view")) {
    return apiError("FORBIDDEN", "Missing permission: products.view", 403);
  }

  const url = new URL(req.url);
  const reason = (url.searchParams.get("reason") ?? "").trim();
  if (!reason) {
    return apiError("INVALID_INPUT", "A non-empty export reason is required.", 400);
  }
  const query = url.searchParams.get("q") ?? undefined;
  const categorySlug = url.searchParams.get("category") ?? undefined;
  const status = url.searchParams.get("status") ?? "ALL";

  try {
    const repo = await getCatalogRepository();
    const filter = { query, categorySlug, status, pageSize: PAGE_SIZE };

    const first = await repo.listProducts({ ...filter, page: 1 });
    const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(first.total / PAGE_SIZE)));
    const products: Product[] = [...first.products];
    for (let page = 2; page <= totalPages; page += 1) {
      const result = await repo.listProducts({ ...filter, page });
      products.push(...result.products);
    }

    const canSeeCost = hasPermission(session.permissions, "products.edit_cost_price");
    const exportable = products.map((p) => ({
      ...p,
      // stripCostPrice REMOVES the costPoisha key; the CSV needs an
      // explicit empty cell instead, so normalize it back to null.
      variants: canSeeCost
        ? p.variants
        : p.variants.map((v) => {
            const stripped = stripCostPrice(v, session.permissions);
            return { ...stripped, costPoisha: stripped.costPoisha ?? null };
          }),
    }));

    const rows = exportable.flatMap(productRows);
    const now = new Date();
    const filterSummary =
      [
        query ? `q=${query}` : null,
        categorySlug ? `category=${categorySlug}` : null,
        `status=${status}`,
      ]
        .filter(Boolean)
        .join("; ") || "none";

    const csvBody = [
      "# PRODUCTS EXPORT — Advance Ecommerce (catalog database)",
      `# exported-by: ${session.userId}`,
      `# exported-at: ${dhakaTimestamp(now)} (Asia/Dhaka)`,
      `# reason: ${reason.replace(/\n/g, " ")}`,
      `# filters: ${filterSummary}`,
      `# products: ${exportable.length}`,
      `# rows: ${rows.length}`,
      CSV_HEADER,
      ...rows,
    ].join("\n");
    // UTF-8 BOM so Excel renders the Bangla titles correctly.
    const csv = `\uFEFF${csvBody}`;

    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.export",
      entityId: null,
      afterJson: {
        filters: filterSummary,
        productCount: exportable.length,
        rowCount: rows.length,
        costIncluded: canSeeCost,
      },
      reason,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({
      data: {
        filename: `products-export-${now.toISOString().slice(0, 10)}.csv`,
        contentType: "text/csv",
        csv,
        rowCount: rows.length,
        productCount: exportable.length,
      },
      meta: {
        persistence: "database",
        note: "One row per variant; prices converted from integer poisha to taka (2dp). Export recorded in the AuditLog.",
      },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
