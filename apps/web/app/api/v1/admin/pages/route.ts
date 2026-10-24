import { NextResponse } from "next/server";
import { cmsStore as store, pageInputSchema } from "@/reports/cms";
import { guardError, requireAdmin } from "@/reports/guard";

// CMS pages/blog — Agent 10, Step 29. RBAC: content.page.
// In-memory store; slug uniqueness + redirect-on-rename live in CmsStore.

export async function GET(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const kind = new URL(req.url).searchParams.get("kind");
  const pages = store.list(kind === "post" ? "post" : kind === "page" ? "page" : undefined);
  return NextResponse.json({ data: { pages, redirects: store.listRedirects() }, meta: { persistence: "in-memory-stub" } });
}
export async function POST(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = pageInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid page.", details: parsed.error.issues } }, { status: 400 });
  try {
    const page = store.create(parsed.data);
    return NextResponse.json({ data: { page }, meta: { persistence: "in-memory-stub" } }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: { code: "SLUG_EXISTS", message: e instanceof Error ? e.message : "Slug exists." } }, { status: 409 });
  }
}
