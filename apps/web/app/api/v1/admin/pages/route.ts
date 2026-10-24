import { NextResponse } from "next/server";
import { cmsStore as store, pageInputSchema } from "@/reports/cms";
import { guardError, requireAdmin } from "@/reports/guard";

// CMS pages/blog — Step 29. RBAC: content.page.
// DB-backed store (Prisma CmsPage/CmsPost); slug uniqueness +
// redirect-on-rename live in CmsStore.

export async function GET(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const kind = new URL(req.url).searchParams.get("kind");
  const pages = await store.list(kind === "post" ? "post" : kind === "page" ? "page" : undefined);
  return NextResponse.json({ data: { pages, redirects: await store.listRedirects() }, meta: { persistence: "database" } });
}
export async function POST(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = pageInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid page.", details: parsed.error.issues } }, { status: 400 });
  try {
    const page = await store.create(parsed.data);
    return NextResponse.json({ data: { page }, meta: { persistence: "database" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: { code: "SLUG_EXISTS", message: e instanceof Error ? e.message : "Slug exists." } }, { status: 409 });
  }
}
