import { runAiContentRoute } from "@/ai/content-route";

// POST /api/v1/admin/products/ai-description
// Wave 57 part A (ADV-24): AI bilingual product-description draft
// (+ SEO fields from the same generation) over the owner's provider.
// Guard products.edit; flag module.ai_content (403 FEATURE_LOCKED);
// unconfigured provider → 503 AI_NOT_CONFIGURED. DRAFT ONLY — this
// route never saves to the product; the editor fills its form fields
// and a human reviews + saves. Shared logic: src/ai/content-route.ts.
export async function POST(req: Request) {
  return runAiContentRoute(req, "description");
}
