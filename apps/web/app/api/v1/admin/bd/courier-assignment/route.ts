import { NextResponse } from "next/server";
import {
  assignCourier,
  courierAssignmentRequestSchema,
  SAMPLE_COURIER_STATS,
  SAMPLE_STATS_META,
} from "@/bd/courier-assignment";
import { guardError, requireAdmin } from "@/reports/guard";

// POST /api/v1/admin/bd/courier-assignment — Agent 51 (BD differentiator).
// RBAC: orders.view.
// Pure computation, no persistence, NO real courier call: the engine
// ranks couriers from order facts + a stats table and returns the full
// ranking, the exclusions and a per-rule trace. When the caller does
// not supply `stats`, the labelled TEMPORARY DEMO sample table is used
// (meta.statsSource says so) — sample numbers are never presented as
// measured courier performance.
export async function POST(req: Request) {
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = courierAssignmentRequestSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid courier assignment request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const stats = parsed.data.stats ?? SAMPLE_COURIER_STATS;
  const result = assignCourier(parsed.data.order, stats);
  return NextResponse.json({
    data: result,
    meta: {
      persistence: "none-pure-logic",
      statsSource: parsed.data.stats ? "caller_supplied" : SAMPLE_STATS_META.source,
    },
  });
}
