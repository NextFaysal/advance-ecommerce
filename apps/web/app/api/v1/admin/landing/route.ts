import { NextResponse } from "next/server";
import { landingStore as store } from "@/landing/store";
import { landingPageInputSchema, validateLandingPage } from "@/landing/validate";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { guardError, requireAdmin } from "@/reports/guard";

// Landing pages — Agent 53. RBAC: content.page (same convention as the
// CMS Pages API — landing is a marketing-content surface, no dedicated
// landing permission exists). In-memory demo store; publish validation
// runs against the TEMPORARY MOCK catalog list.

export async function GET() {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json(
    { data: { pages: store.list() }, meta: { persistence: "in-memory-demo", marker: "TEMPORARY_DEMO" } },
  );
}

export async function POST(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = landingPageInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid landing page.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const validation = validateLandingPage(parsed.data, MOCK_PRODUCTS, store.otherSlugs());
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Landing page validation failed.", details: validation.errors } },
      { status: 400 },
    );
  }
  try {
    const page = store.create(parsed.data);
    return NextResponse.json(
      { data: { page }, meta: { persistence: "in-memory-demo", marker: "TEMPORARY_DEMO" } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: { code: "SLUG_EXISTS", message: e instanceof Error ? e.message : "Slug exists." } },
      { status: 409 },
    );
  }
}
