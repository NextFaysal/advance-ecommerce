import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, requireAdminSession } from "@/catalog/api";
import { hasPermission } from "@/lib/rbac";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { SourcingError, extractProductFromUrl } from "@/sourcing/extract";

// POST /api/v1/admin/sourcing/preview — Wave 15-3 (doc 16 §P7).
// Body: { url: string }. The server fetches the merchant-pasted
// product URL and extracts a draft (title / description / images /
// price + currency) via src/sourcing/extract.ts — JSON-LD first, then
// OpenGraph, then tag fallbacks. NOTHING is saved by this route; the
// merchant reviews and edits the preview, then calls /create.
// Gated by the module.sourcing flag (paid add-on, OFF by default) and
// products.create. Failures are honest, specific Bangla errors —
// a blocked bot fetch says so, it never fabricates a preview.
const bodySchema = z.object({
  url: z.string().min(8).max(2048),
});

export async function POST(req: Request) {
  const session = await requireAdminSession();
  if (session instanceof NextResponse) return session;
  if (!hasPermission(session.permissions, "products.create")) {
    return apiError("FORBIDDEN", "Missing permission: products.create", 403);
  }
  await ensureDbFeatureFlags();
  if (!featureFlags.isFeatureEnabled("module.sourcing")) {
    return apiError("FEATURE_LOCKED", "সোর্সিং মডিউল বন্ধ আছে (module.sourcing OFF) — Admin > Settings > Feature Flags থেকে চালু করুন।", 403);
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("VALIDATION_ERROR", "পণ্যের পেজের সঠিক লিংক দিন।", 400);
  }
  try {
    const preview = await extractProductFromUrl(parsed.data.url);
    return NextResponse.json({
      data: preview,
      meta: { strategies: preview.strategies, note: "Preview only — nothing is saved until create." },
    });
  } catch (error) {
    if (error instanceof SourcingError) {
      return apiError(error.code, error.message, error.status);
    }
    console.error("Sourcing preview failed");
    void error;
    return apiError("INTERNAL", "প্রিভিউ আনার সময় সমস্যা হয়েছে — আবার চেষ্টা করুন।", 500);
  }
}
