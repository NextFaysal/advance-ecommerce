import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { setReviewStatusSchema } from "@/reviews/schema";
import { setReviewStatus } from "@/reviews/store";

// PATCH /api/v1/admin/reviews/[id] — approve / reject / re-pend.
// RBAC: content.page. A status change re-syncs the product's
// denormalized ratingAverage / reviewCount in the same call, so the
// storefront (cards, PDP) reflects the decision immediately.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => ({}));
  const parsed = setReviewStatusSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid review status.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const review = await setReviewStatus(params.id, parsed.data.status);
  if (!review) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Review not found." } },
      { status: 404 },
    );
  }
  return NextResponse.json({
    data: { review },
    meta: { persistence: "database" },
  });
}
