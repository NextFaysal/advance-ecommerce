import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { requireFeature } from "@/ai/feature-flag";
import { AI_FEATURE_FLAG } from "@/ai/types";
import { generateDescription, generateSeo, suggestImageAlt } from "@/ai/description";

// POST /api/v1/admin/ai/describe
// TEMPLATE FALLBACK ONLY — no AI model is called. Results carry
// meta.engine "template-fallback" and requiresReview: true; the UI must
// show that label. RBAC: products.edit. Flag: module.ai_assist.
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
  return NextResponse.json({
    data: {
      description: generateDescription(input),
      seo: generateSeo(input),
      imageAlt: suggestImageAlt(input, input.imageIndex),
    },
    meta: { engine: "template-fallback", note: "No AI provider is configured. Template output — review before publishing." },
  });
}
