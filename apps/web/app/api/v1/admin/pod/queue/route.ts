/**
 * Print queue — /api/v1/admin/pod/queue (ADV-23 vertical 5,
 * wave 56).
 *
 *   GET  -> the press line: orders carrying a frozen `[pod:]`
 *           customisation that has NOT been attested printed and
 *           whose status can still reach the press (CANCELLED /
 *           DELIVERED / REFUNDED / RETURNED are excluded — see
 *           src/pod/customisation.ts), oldest first. Customers
 *           appear as first name + masked phone only. Guard:
 *           admin session + orders.view, then the
 *           module.print_on_demand flag (src/pod/guard.ts).
 *           The admin page polls this route every 30s — a
 *           polling read, not realtime, and the UI says so.
 *   POST { orderId } -> attest the print is done: appends the
 *           `[pod-printed]` OrderNote under the caller's
 *           authorship, which removes the order from the queue.
 *           Idempotent (a second POST reports alreadyPrinted and
 *           writes nothing). Guard: orders.edit + the flag. An
 *           order with no custom print is a 404 POD_NOT_FOUND.
 *
 * There is deliberately no POD status table: the notes ARE the
 * record (the house OrderNote-marker convention).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePodAccess } from "@/pod/guard";
import { getPrintQueue, markPodPrinted } from "@/pod/customisation";

export const dynamic = "force-dynamic";

export async function GET() {
  const outcome = await requirePodAccess("orders.view");
  if (!outcome.ok) return outcome.response;

  try {
    const queue = await getPrintQueue();
    return NextResponse.json({ data: queue, meta: { persistence: "database" } });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Print queue needs a working database connection." } },
      { status: 503 },
    );
  }
}

const postSchema = z.object({
  orderId: z.string().min(1),
});

export async function POST(req: Request) {
  const outcome = await requirePodAccess("orders.edit");
  if (!outcome.ok) return outcome.response;

  const parsed = postSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Print-queue input invalid.",
          details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
      },
      { status: 400 },
    );
  }

  const result = await markPodPrinted(parsed.data.orderId, outcome.access.userId);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: result.code, message: result.message } },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json({
    data: { orderId: result.orderId, printed: true, alreadyPrinted: result.alreadyPrinted },
    meta: { persistence: "database" },
  });
}
