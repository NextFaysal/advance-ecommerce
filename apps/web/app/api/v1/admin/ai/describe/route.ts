import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { AI_FEATURE_FLAG } from "@/ai/types";
import { suggestImageAlt } from "@/ai/description";
import { aiProvider } from "@/ai/provider";

// POST /api/v1/admin/ai/describe
// AI PROVIDER with graceful template fallback. Results carry
// meta.engine ("provider" or "template-fallback") and requiresReview label.
// RBAC: products.edit. Flag: module.ai_assist.
const localized = z.object({ bn: z.string().min(1), en: z.string().min(1) });
const bodySchema = z.object({
  product: z.object({
    title: localized,
    categoryName: localized,
    brandName: z.string().nullable(),
    tags: z.array(z.string()),
    ratingAverage: z.number().nullable(),
    reviewCount: z.number().int().min(0),
    attributes: z.record(z.array(z.string())),
    minPricePoisha: z.number().int().min(0),
    maxPricePoisha: z.number().int().min(0),
  }),
  locale: z.enum(["bn", "en"]),
  imageIndex: z.number().int().min(0).default(0),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("products.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flag = await requireFeature(AI_FEATURE_FLAG);
  if (!flag.enabled) return NextResponse.json({ error: { code: flag.code, message: flag.message } }, { status: flag.status });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid product input.", details: parsed.error.flatten() } }, { status: 400 });
  }
  const input = parsed.data;
  const [description, seo] = await Promise.all([
    aiProvider.generateDescription(input),
    aiProvider.generateSeo(input),
  ]);
  const imageAlt = suggestImageAlt(input, input.imageIndex);

  return NextResponse.json({
    data: {
      description,
      seo,
      imageAlt,
    },
    meta: {
      engine: description.meta.engine,
      note: description.meta.label,
    },
  });
}
