import { NextResponse } from "next/server";
import { readSiteContent, saveSiteContent } from "@/cms/site-content";
import { siteContentInputSchema } from "@/cms/site-content-schema";
import { guardError, requireAdmin } from "@/reports/guard";

// Site content — header/footer menus + homepage hero slides.
// RBAC: content.page (same convention as the CMS Pages + Landing
// APIs). Persistence: the Setting table under cms.* keys (the schema
// has no Menu model — see src/cms/site-content.ts). Sections the
// owner has never saved come back as the BUILT-IN DEFAULTS with
// configured: false — they are fallback copy, not saved content.

export async function GET() {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const { content, configured } = await readSiteContent();
  return NextResponse.json({
    data: { ...content, configured },
    meta: { persistence: "database", storage: "Setting table (cms.* keys)" },
  });
}

export async function PUT(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = siteContentInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid site content.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  await saveSiteContent(parsed.data, guard.userId);
  const { content, configured } = await readSiteContent();
  return NextResponse.json({
    data: { ...content, configured },
    meta: { persistence: "database", storage: "Setting table (cms.* keys)" },
  });
}
