import { runAiContentRoute } from "@/ai/content-route";

// POST /api/v1/admin/products/ai-seo
// Wave 57 part A (ADV-24): AI SEO draft (seoTitleBn / seoTitleEn /
// seoDescriptionBn / seoDescriptionEn) over the owner's provider.
// Separate route from ai-description so the audit actions stay 1:1
// (ai.seo.generate vs ai.description.generate) and each editor button
// pays only for the generation it triggers. Guard products.edit;
// flag module.ai_content (403 FEATURE_LOCKED); unconfigured provider
// → 503 AI_NOT_CONFIGURED. DRAFT ONLY — never saves to the product.
// Shared logic: src/ai/content-route.ts.
export async function POST(req: Request) {
  return runAiContentRoute(req, "seo");
}
