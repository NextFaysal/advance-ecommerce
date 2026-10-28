import { NextResponse } from "next/server";
import { landingStore as store } from "@/landing/store";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/landing/[id]/duplicate — doc 34 L6. RBAC:
// content.page (the landing convention). One-click page copy through
// the store's duplicate(): the copy is always a DRAFT with a fresh
// uniquified slug ("<slug>-copy", "-copy-2", …), deep-copied
// sections and the source's SEO block; the schedule window is not
// carried over (see store.duplicate). Mirrors the products duplicate
// route's shape: 201 + { data: { page, sourceId } }.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const page = await store.duplicate(params.id);
    return NextResponse.json(
      { data: { page, sourceId: params.id }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "Duplicate failed.";
    if (message === "landing_page_not_found") {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Landing page not found." } }, { status: 404 });
    }
    if (message === "copy_limit") {
      return NextResponse.json(
        { error: { code: "COPY_LIMIT", message: "Could not find a free slug suffix for another copy of this page." } },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: { code: "DUPLICATE_FAILED", message } }, { status: 400 });
  }
}
