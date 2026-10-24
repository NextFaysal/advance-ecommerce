import { NextResponse } from "next/server";
import { z } from "zod";
import { landingStore as store } from "@/landing/store";
import { landingPageInputSchema, validateLandingPage } from "@/landing/validate";
import { tryCatalogRepository } from "@/catalog/server-read";
import { guardError, requireAdmin } from "@/reports/guard";

// PATCH /api/v1/admin/landing/[id] — Agent 53. RBAC: content.page.
// Two body shapes:
//   { status }     -> status transition through the landing status
//                     flow (publishing re-validates against the
//                     catalog inside the store).
//   full page body -> content update (slug/titles/sections — the
//                     builder's Save): validated with the same
//                     schema + validateLandingPage the create route
//                     runs, then store.update().
// Pages persist in the DB (Prisma LandingPage).
const patchSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const page = await store.get(params.id);
  if (!page) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Landing page not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));

  // Full-body content update (builder Save). Detected by the presence
  // of sections/slug — a bare { status } body takes the flow below.
  if (typeof body === "object" && body !== null && ("sections" in body || "slug" in body)) {
    const parsedFull = landingPageInputSchema.safeParse(body);
    if (!parsedFull.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "Invalid landing page.", details: parsedFull.error.issues } },
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
    const validation = validateLandingPage(parsedFull.data, products, await store.otherSlugs(params.id));
    if (!validation.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", message: "Landing page validation failed.", details: validation.errors } },
        { status: 400 },
      );
    }
    try {
      const updated = await store.update(params.id, parsedFull.data);
      return NextResponse.json({ data: { page: updated }, meta: { persistence: "database" } });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Update failed.";
      return NextResponse.json(
        { error: { code: message === "slug_already_exists" ? "SLUG_EXISTS" : "UPDATE_FAILED", message } },
        { status: message === "slug_already_exists" ? 409 : 400 },
      );
    }
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid status.", details: parsed.error.issues } },
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
  const result = await store.setStatus(params.id, parsed.data.status, products);
  if (!result.ok) {
    return NextResponse.json(
      {
        error: {
          code: result.code,
          message: result.messageEn,
          details: result.validation?.errors ?? undefined,
        },
      },
      { status: 400 },
    );
  }
  return NextResponse.json({
    data: { page: result.page },
    meta: { persistence: "database" },
  });
}
