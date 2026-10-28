import { NextResponse } from "next/server";
import { z } from "zod";
import { funnelStore as store, validateFunnelForPublish } from "@/funnels/store";
import { funnelInputSchema, validateFunnelGraph } from "@/funnels/validate";
import { guardError, requireAdmin } from "@/reports/guard";

// /api/v1/admin/funnels/[id] — doc 34 §3.7. RBAC: content.page.
// PATCH accepts two body shapes (the landing [id] convention):
//   { status }     -> status transition through the funnel status
//                     flow (publishing re-validates the graph, the
//                     step pages and the offers inside the store).
//   full funnel    -> content update (name/slug/steps — the future
//                     builder's Save): graph-validated with the same
//                     rules the create route runs, plus full publish
//                     validation when the result would be PUBLISHED,
//                     then store.update().
// DELETE removes the funnel row only — step pages are ordinary
// landing pages and are never deleted with a funnel.
const patchSchema = z.object({
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const funnel = await store.get(params.id);
  if (!funnel) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Funnel not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { funnel }, meta: { persistence: "database" } });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const funnel = await store.get(params.id);
  if (!funnel) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Funnel not found." } }, { status: 404 });
  }
  const body = await req.json().catch(() => ({}));

  // Full-body content update. Detected by the presence of steps/slug
  // — a bare { status } body takes the flow below.
  if (typeof body === "object" && body !== null && ("steps" in body || "slug" in body)) {
    const parsedFull = funnelInputSchema.safeParse(body);
    if (!parsedFull.success) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "Invalid funnel.", details: parsedFull.error.issues } },
        { status: 400 },
      );
    }
    const graph = validateFunnelGraph(parsedFull.data, await store.otherSlugs(params.id));
    if (!graph.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_FAILED", message: "Funnel validation failed.", details: graph.errors } },
        { status: 400 },
      );
    }
    if (parsedFull.data.status === "PUBLISHED") {
      const publish = await validateFunnelForPublish(parsedFull.data, await store.otherSlugs(params.id));
      if (!publish.ok) {
        return NextResponse.json(
          { error: { code: "VALIDATION_FAILED", message: "Funnel publish validation failed.", details: publish.errors } },
          { status: 400 },
        );
      }
    }
    try {
      const updated = await store.update(params.id, parsedFull.data);
      return NextResponse.json({ data: { funnel: updated }, meta: { persistence: "database" } });
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
  const result = await store.setStatus(params.id, parsed.data.status);
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
    data: { funnel: result.funnel },
    meta: { persistence: "database" },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("content.page");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const funnel = await store.get(params.id);
  if (!funnel) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Funnel not found." } }, { status: 404 });
  }
  const deleted = await store.delete(params.id);
  if (!deleted) {
    return NextResponse.json({ error: { code: "DELETE_FAILED", message: "Funnel could not be deleted." } }, { status: 400 });
  }
  return NextResponse.json({ data: { deleted: true, id: params.id }, meta: { persistence: "database" } });
}
