/**
 * Shared handler for the wave-57 AI content routes:
 *   POST /api/v1/admin/products/ai-description
 *   POST /api/v1/admin/products/ai-seo
 *
 * Contract (both routes):
 * - Guard: admin session + products.edit.
 * - Flag `module.ai_content` OFF → 403 FEATURE_LOCKED (the verticals'
 *   convention; checked before any generation work).
 * - Body: { productId } OR draft fields (productName, productNameEn,
 *   categoryName, brandName, attributes, keywords, tone). With a
 *   productId the stored product supplies the base facts and any draft
 *   fields override them. Unknown productId → 404 NOT_FOUND.
 * - Provider unconfigured → 503 AI_NOT_CONFIGURED; provider failure →
 *   502 AI_PROVIDER_ERROR / AI_INVALID_RESPONSE (src/ai/content.ts —
 *   template text is never served as AI output).
 * - The response is a DRAFT ONLY: this handler never writes to the
 *   product. The editor fills form fields and a human saves.
 * - Every successful generation is audit-logged
 *   (ai.description.generate / ai.seo.generate) with the productId.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  getCatalogRepository,
  handleServiceError,
  requireAdminSession,
} from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { writeAudit } from "@/lib/audit";
import {
  AI_CONTENT_FLAG,
  AiContentError,
  generateProductDescription,
  generateProductSeo,
  type AiContentInput,
} from "./content";

const bodySchema = z
  .object({
    productId: z.string().trim().min(1).optional(),
    productName: z.string().trim().min(1).max(300).optional(),
    productNameEn: z.string().trim().min(1).max(300).optional(),
    categoryName: z.string().trim().min(1).max(200).optional(),
    brandName: z.string().trim().min(1).max(200).optional(),
    attributes: z.record(z.array(z.string().max(200)).max(50)).optional(),
    keywords: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
    tone: z.string().trim().min(1).max(60).optional(),
  })
  .refine((d) => d.productId !== undefined || d.productName !== undefined, {
    message: "Provide productId or draft fields (productName at minimum).",
  });

export type AiContentKind = "description" | "seo";

export async function runAiContentRoute(
  req: Request,
  kind: AiContentKind,
): Promise<NextResponse> {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.edit")) {
    return apiError("FORBIDDEN", "Missing permission: products.edit", 403);
  }
  await ensureDbFeatureFlags().catch(() => {});
  if (!isFeatureEnabled(AI_CONTENT_FLAG)) {
    return apiError(
      "FEATURE_LOCKED",
      `Feature ${AI_CONTENT_FLAG} is not enabled for this store. Enable it in Admin > Settings > Feature Flags.`,
      403,
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid AI content input.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }
  const body = parsed.data;

  try {
    // Base facts from the stored product when an id is given; draft
    // fields (the editor's current form state) override them.
    let input: AiContentInput = { productName: "", attributes: {}, keywords: [] };
    if (body.productId) {
      const repo = await getCatalogRepository();
      const product = await repo.getProductById(body.productId);
      if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
      input = {
        productName: product.title.bn || product.title.en,
        productNameEn: product.title.en || undefined,
        categoryName: product.categoryName.bn || product.categoryName.en,
        brandName: product.brandName ?? undefined,
        attributes: {},
        keywords: product.tags,
      };
    }
    input = {
      productName: body.productName ?? input.productName,
      productNameEn: body.productNameEn ?? input.productNameEn,
      categoryName: body.categoryName ?? input.categoryName,
      brandName: body.brandName ?? input.brandName,
      attributes: body.attributes ?? input.attributes,
      keywords: body.keywords ?? input.keywords,
      tone: body.tone,
    };

    const draft =
      kind === "description"
        ? await generateProductDescription(input)
        : await generateProductSeo(input);

    await writeAudit({
      actorId: session.userId,
      action:
        kind === "description" ? "ai.description.generate" : "ai.seo.generate",
      entityType: "Product",
      entityId: body.productId ?? null,
      afterJson: {
        engine: "provider",
        draftOnly: true,
        productName: input.productName,
        fields: Object.keys(draft),
      },
    });

    return NextResponse.json({
      data: draft,
      meta: {
        engine: "provider",
        draft: true,
        requiresReview: true,
        note: "AI-generated draft — review before saving. Nothing was saved to the product.",
      },
    });
  } catch (error) {
    if (error instanceof AiContentError) {
      return apiError(error.code, error.message, error.status);
    }
    return handleServiceError(error);
  }
}
