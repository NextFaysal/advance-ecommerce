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
import { DbNotReadyError } from "@/catalog/service";
import type { Product } from "@/catalog/types";

// POST /api/v1/admin/products/bulk — list power tools (Wave 13-3).
// One call applies ONE action to many products, composing the SAME
// repository operations the single-product routes use, so every
// invariant is inherited rather than re-implemented:
//   - "status"       -> repo.updateProduct({ status })         (products.edit)
//   - "price-adjust" -> repo.updateProduct({ variants, reason }) (products.edit)
//     Every variant price moves by `percent`; the service's
//     price-change rule still fires — `reason` is REQUIRED here and
//     passed through untouched, never bypassed.
//   - "delete"       -> repo.deleteProduct (soft delete)       (products.delete)
//     `reason` required, exactly like DELETE /[id].
// Each id is processed independently and reported in `results` — a
// failure on one product never hides or rolls back the others. The
// per-product audits mirror what the single-product routes write
// (products.edit / products.price_change / products.delete), plus ONE
// summary audit (products.bulk) for the batch itself. Ids are capped
// at 100 per call.

const bulkRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  action: z.enum(["status", "price-adjust", "delete"]),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  percent: z.number().finite().gt(-100).lte(1000).optional(),
  reason: z.string().max(500).optional(),
});

type BulkOutcome =
  | { id: string; ok: true; changed: boolean }
  | { id: string; ok: false; code: string; message: string };

function failure(id: string, error: unknown): BulkOutcome {
  if (error instanceof Error && error.message.includes("not found")) {
    return { id, ok: false, code: "NOT_FOUND", message: error.message };
  }
  if (error instanceof Error && error.message.includes("Reason is required")) {
    return { id, ok: false, code: "REASON_REQUIRED", message: error.message };
  }
  return { id, ok: false, code: "INTERNAL", message: "Something went wrong." };
}

/** Full variant payload for updateProduct — update semantics replace
 *  the variant set by SKU, so EVERY field is carried from the stored
 *  product; only the field the bulk action owns is changed. */
function variantInputs(product: Product, pricePoishaBySku?: Map<string, number>) {
  return product.variants.map((v) => ({
    attributes: v.attributes,
    sku: v.sku,
    barcode: v.barcode,
    pricePoisha: pricePoishaBySku?.get(v.sku) ?? v.pricePoisha,
    compareAtPoisha: v.compareAtPoisha,
    costPoisha: v.costPoisha,
    stock: v.stock,
    imageUrl: v.imageUrl,
    isActive: v.isActive,
  }));
}

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  const body = await req.json().catch(() => ({}));
  const parsed = bulkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Bulk request is invalid.",
          details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
        },
      },
      { status: 400 },
    );
  }
  const input = parsed.data;
  const permission = input.action === "delete" ? "products.delete" : "products.edit";
  if (!hasPermission(session.permissions, permission)) {
    return apiError("FORBIDDEN", `Missing permission: ${permission}`, 403);
  }
  if (input.action === "status" && input.status === undefined) {
    return apiError("VALIDATION_ERROR", "status is required for the status action.", 400);
  }
  if (input.action === "price-adjust") {
    if (input.percent === undefined) {
      return apiError("VALIDATION_ERROR", "percent is required for the price-adjust action.", 400);
    }
    if (input.reason === undefined || input.reason.trim() === "") {
      return apiError(
        "REASON_REQUIRED",
        "A reason is required to adjust prices (products.price_change).",
        400,
      );
    }
  }
  if (input.action === "delete" && (input.reason === undefined || input.reason.trim() === "")) {
    return apiError("REASON_REQUIRED", "A reason is required to delete products (products.delete).", 400);
  }
  // De-duplicate: processing the same product twice in one batch would
  // double-apply price percentages and double-write audits.
  const ids = [...new Set(input.ids)];
  const reason = input.reason?.trim();
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  try {
    const repo = await getCatalogRepository();
    const results: BulkOutcome[] = [];
    for (const id of ids) {
      try {
        if (input.action === "status") {
          const target = input.status as "DRAFT" | "ACTIVE" | "ARCHIVED";
          const before = await repo.getProductById(id);
          if (!before) {
            results.push({ id, ok: false, code: "NOT_FOUND", message: "Product not found." });
            continue;
          }
          if (before.status === target) {
            results.push({ id, ok: true, changed: false });
            continue;
          }
          const { product } = await repo.updateProduct(id, { status: target }, session.userId);
          await writeCatalogAudit({
            actorId: session.userId,
            action: "products.edit",
            entityId: product.id,
            beforeJson: { slug: before.slug, status: before.status },
            afterJson: { slug: product.slug, status: product.status },
            ip,
            userAgent,
          });
          results.push({ id, ok: true, changed: true });
        } else if (input.action === "price-adjust") {
          const percent = input.percent as number;
          const before = await repo.getProductById(id);
          if (!before) {
            results.push({ id, ok: false, code: "NOT_FOUND", message: "Product not found." });
            continue;
          }
          const factor = (100 + percent) / 100;
          const newPrices = new Map<string, number>(
            before.variants.map(
              (v): [string, number] => [v.sku, Math.max(0, Math.round(v.pricePoisha * factor))],
            ),
          );
          const changed = before.variants.some((v) => newPrices.get(v.sku) !== v.pricePoisha);
          if (!changed) {
            // e.g. percent 0, or rounding lands every price back where
            // it started — an honest no-op, not a silent success.
            results.push({ id, ok: true, changed: false });
            continue;
          }
          const { product } = await repo.updateProduct(
            id,
            { variants: variantInputs(before, newPrices), reason },
            session.userId,
          );
          await writeCatalogAudit({
            actorId: session.userId,
            action: "products.price_change",
            entityId: product.id,
            beforeJson: { slug: before.slug, status: before.status },
            afterJson: { slug: product.slug, status: product.status, percent },
            reason,
            ip,
            userAgent,
          });
          results.push({ id, ok: true, changed: true });
        } else {
          // action === "delete" — same soft-delete + audit shape as
          // DELETE /api/v1/admin/products/[id].
          const result = await repo.deleteProduct(id);
          if (!result) {
            results.push({ id, ok: false, code: "NOT_FOUND", message: "Product not found." });
            continue;
          }
          await writeCatalogAudit({
            actorId: session.userId,
            action: "products.delete",
            entityId: result.product.id,
            beforeJson: { slug: result.product.slug, status: result.product.status },
            afterJson: { deleted: true, alreadyDeleted: result.alreadyDeleted },
            reason,
            ip,
            userAgent,
          });
          results.push({ id, ok: true, changed: !result.alreadyDeleted });
        }
      } catch (error) {
        // A dead database fails the whole batch honestly (503), not
        // 100 fake per-id failures.
        if (error instanceof DbNotReadyError) throw error;
        results.push(failure(id, error));
      }
    }
    const succeeded = results.filter((r) => r.ok).length;
    await writeCatalogAudit({
      actorId: session.userId,
      action: "products.bulk",
      entityId: null,
      afterJson: {
        bulkAction: input.action,
        ...(input.action === "status" ? { status: input.status } : {}),
        ...(input.action === "price-adjust" ? { percent: input.percent } : {}),
        requested: ids.length,
        succeeded,
        failed: ids.length - succeeded,
      },
      reason,
      ip,
      userAgent,
    });
    return NextResponse.json({
      data: {
        action: input.action,
        requested: ids.length,
        succeeded,
        failed: ids.length - succeeded,
        results,
      },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}
