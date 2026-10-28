/**
 * POST /api/v1/public/pharmacy/rx-check — ADV-22 (doc 22).
 *
 * The checkout page asks ONE question: does this cart contain a
 * prescription-required item? Body: { variantIds: string[] }.
 * Returns { enabled, required, rxVariantIds } — product tags are
 * merchant data, not secrets, and the answer reveals nothing beyond
 * what the PDP/catalogue already shows. The SERVER re-derives the
 * requirement from DB tags inside the orders route at submit time;
 * this endpoint only drives the form display.
 *
 * Pack off → { enabled: false, required: false } (never an error:
 * checkout must not block on a display helper).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPackEnabled } from "@/business-modules/packs";
import { getVariantRxMap } from "@/business-modules/pharmacy-orders";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  variantIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit(`rx-check:${ip}`, 60, 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { code: "RATE_LIMITED", message: "Too many requests — please try again shortly." } },
      { status: 429 },
    );
  }
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "variantIds required." } },
      { status: 400 },
    );
  }
  await ensureDbFeatureFlags().catch(() => {});
  if (!isPackEnabled("pharmacy")) {
    return NextResponse.json({ data: { enabled: false, required: false, rxVariantIds: [] } });
  }
  const rxMap = await getVariantRxMap(parsed.data.variantIds);
  const rxVariantIds = parsed.data.variantIds.filter((id) => rxMap.get(id) === true);
  return NextResponse.json({
    data: { enabled: true, required: rxVariantIds.length > 0, rxVariantIds },
    meta: { persistence: "database" },
  });
}
