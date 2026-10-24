import { NextResponse } from "next/server";
import { cmsStore as store, pageInputSchema } from "@/reports/cms";
import { guardError, requireAdmin } from "@/reports/guard";

// GET/PUT/DELETE /api/v1/admin/pages/[id] — RBAC: content.page.
// DB-backed (Prisma). Renaming a slug records an SeoRedirect row
// (see CmsStore.update); DELETE is a soft delete (deletedAt).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const page = await store.get(params.id);
  if (!page) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Page not found." } }, { status: 404 });
  return NextResponse.json({ data: { page }, meta: { persistence: "database" } });
}
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = pageInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid page.", details: parsed.error.issues } }, { status: 400 });
  try {
    const page = await store.update(params.id, parsed.data);
    return NextResponse.json({ data: { page }, meta: { persistence: "database" } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Page not found.";
    if (message === "slug_already_exists") {
      return NextResponse.json({ error: { code: "SLUG_EXISTS", message } }, { status: 409 });
    }
    return NextResponse.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
  }
}
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const ok = await store.delete(params.id);
  return NextResponse.json({ data: { deleted: ok }, meta: { persistence: "database", softDelete: true } }, { status: ok ? 200 : 404 });
}
