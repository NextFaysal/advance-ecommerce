import { NextResponse } from "next/server";
import { z } from "zod";
import { landingStore as store } from "@/landing/store";
import { MOCK_PRODUCTS } from "@/catalog/mock";
import { guardError, requireAdmin } from "@/reports/guard";

// PATCH /api/v1/admin/landing/[id] — Agent 53. RBAC: content.page.
// Body: { status } transitions the page through the landing status flow
// (publishing re-validates against the catalog inside the store).
const patchSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const page = store.get(params.id);
  if (!page) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Landing page not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid status.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = store.setStatus(params.id, parsed.data.status, MOCK_PRODUCTS);
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
    meta: { persistence: "in-memory-demo", marker: "TEMPORARY_DEMO" },
  });
}
