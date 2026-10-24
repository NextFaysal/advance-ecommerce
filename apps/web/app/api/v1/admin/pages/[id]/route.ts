import { NextResponse } from "next/server";
import { cmsStore as store, pageInputSchema } from "@/reports/cms";
import { guardError, requireAdmin } from "@/reports/guard";

// GET/PUT/DELETE /api/v1/admin/pages/[id] — RBAC: content.page.
// Renaming a slug records a redirect (see CmsStore.update).
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const page = store.get(params.id);
  if (!page) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Page not found." } }, { status: 404 });
  return NextResponse.json({ data: { page }, meta: { persistence: "in-memory-stub" } });
}
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = pageInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: { code: "INVALID_INPUT", message: "Invalid page.", details: parsed.error.issues } }, { status: 400 });
  try {
    const page = store.update(params.id, parsed.data);
    return NextResponse.json({ data: { page }, meta: { persistence: "in-memory-stub" } });
  } catch (e) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: e instanceof Error ? e.message : "Page not found." } }, { status: 404 });
  }
}
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  // Audit note: page/blog delete is a sensitive content action in a Prisma
  // implementation (soft delete + audit with reason). Stub deletes in-memory.
  const ok = store.delete(params.id);
  return NextResponse.json({ data: { deleted: ok }, meta: { persistence: "in-memory-stub", softDeletePending: "prisma" } }, { status: ok ? 200 : 404 });
}
