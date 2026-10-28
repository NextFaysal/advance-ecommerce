import { NextResponse } from "next/server";
import { funnelStore as store, validateFunnelForPublish } from "@/funnels/store";
import { funnelInputSchema, validateFunnelGraph } from "@/funnels/validate";
import { guardError, requireAdmin } from "@/reports/guard";

// Funnels — doc 34 §3.7 (CartFlows layer, data layer first).
// RBAC: content.page (same convention as the Landing/CMS Pages APIs —
// funnels are a marketing-content surface, no dedicated funnel
// permission exists). Funnels persist in the DB (Prisma Funnel);
// they are orchestration only — steps reference LandingPage rows,
// and publish validation runs the step-graph rules + each step
// page's own landing validation + live-catalog offer resolution.

export async function GET() {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  return NextResponse.json(
    { data: { funnels: await store.list() }, meta: { persistence: "database" } },
  );
}

export async function POST(req: Request) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = funnelInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid funnel.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const graph = validateFunnelGraph(parsed.data, await store.otherSlugs());
  if (!graph.ok) {
    return NextResponse.json(
      { error: { code: "VALIDATION_FAILED", message: "Funnel validation failed.", details: graph.errors } },
      { status: 400 },
    );
  }
  // A create that lands directly on PUBLISHED must pass the same
  // full publish validation as the status flow.
  if (parsed.data.status === "PUBLISHED") {
    const publish = await validateFunnelForPublish(parsed.data, await store.otherSlugs());
    if (!publish.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", message: "Funnel publish validation failed.", details: publish.errors } },
        { status: 400 },
      );
    }
  }
  try {
    const funnel = await store.create(parsed.data);
    return NextResponse.json(
      { data: { funnel }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: { code: "SLUG_EXISTS", message: e instanceof Error ? e.message : "Slug exists." } },
      { status: 409 },
    );
  }
}
