import { NextResponse } from "next/server";
import { landingStore as store } from "@/landing/store";
import { landingPageInputSchema, validateLandingPage } from "@/landing/validate";
import { tryCatalogRepository } from "@/catalog/server-read";
import { guardError, requireAdmin } from "@/reports/guard";

// Landing pages — Agent 53. RBAC: content.page (same convention as the
// CMS Pages API — landing is a marketing-content surface, no dedicated
// landing permission exists). Pages persist in the DB (Prisma
// LandingPage); publish validation runs against the REAL catalog DB
// (ACTIVE products from the Prisma repository).

export async function GET() {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json(
    { data: { pages: await store.list() }, meta: { persistence: "database" } },
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
  const repo = await tryCatalogRepository();
  if (!repo) {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Catalog database is not available." } },
      { status: 503 },
    );
  }
  const { products } = await repo.listProducts({ status: "ACTIVE", page: 1, pageSize: 100 });
  const validation = validateLandingPage(parsed.data, products, await store.otherSlugs());
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Landing page validation failed.", details: validation.errors } },
      { status: 400 },
    );
  }
  try {
    const page = await store.create(parsed.data);
    return NextResponse.json(
      { data: { page }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: { code: "SLUG_EXISTS", message: e instanceof Error ? e.message : "Slug exists." } },
      { status: 409 },
    );
  }
}
