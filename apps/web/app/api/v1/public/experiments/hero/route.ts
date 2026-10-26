/**
 * GET /api/v1/public/experiments/hero — client-side hero A/B
 * resolution (Wave 46 ISR conversion). The homepage itself is now
 * statically rendered, so the per-visitor experiment resolution
 * that used to run in app/page.tsx (cookies() + resolveHeroForVisitor)
 * moved here: the HeroExperiment client component fetches this on
 * mount and swaps its copy when a variant applies.
 *
 * Semantics are IDENTICAL to the old server seam: the running hero
 * experiment assigns the visitor (by the ae_vid cookie) a variant
 * and records their exposure, deduped per visitor inside
 * resolveHeroForVisitor. Control / no experiment / flag off /
 * no visitor id -> { data: null } -> the client keeps the static
 * default hero copy. Fail-safe: any error also returns
 * { data: null } with 200 — this endpoint must never break the
 * homepage. Per-visitor data, so the response is never cached.
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { resolveHeroForVisitor, VISITOR_COOKIE } from "@/marketing/experiments";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET() {
  try {
    if (!marketingMechanicsEnabled()) {
      return NextResponse.json({ data: null }, { headers: NO_STORE });
    }
    const visitorId = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
    const resolution = await resolveHeroForVisitor(visitorId);
    return NextResponse.json({ data: resolution?.hero ?? null }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ data: null }, { headers: NO_STORE });
  }
}
