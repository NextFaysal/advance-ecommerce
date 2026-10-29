import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";

// GET /api/internal/keep-warm — database keep-warm probe.
//
// Intentionally UNAUTHENTICATED: it exposes nothing (no data, no
// config, only whether a trivial query succeeded and how long it
// took) and changes nothing. It exists to be pinged on a schedule
// (e.g. an external cron every few minutes) so the Neon compute does
// not suspend between real visits — a suspended compute made the
// first admin page load of a session pay seconds of wake-up latency
// on every database call. The cheapest REAL query (SELECT 1 through
// the app's Prisma client) is what counts as activity, so that is
// all this runs.
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export async function GET() {
  const startedAt = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      { ok: true, dbMs: Math.round(performance.now() - startedAt) },
      { status: 200, headers: NO_STORE_HEADERS },
    );
  } catch {
    // Deliberately no error detail: the probe must never leak
    // infrastructure information to an unauthenticated caller.
    return NextResponse.json(
      { ok: false },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
