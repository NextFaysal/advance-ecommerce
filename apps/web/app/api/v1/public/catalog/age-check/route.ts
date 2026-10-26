/**
 * POST /api/v1/public/catalog/age-check — ADV-29 (doc 22), age gate.
 *
 * The checkout page asks ONE question: does this cart contain an
 * item from an age-restricted category (Settings
 * catalog.age_restricted_categories)? Body: { variantIds: string[] }.
 * Returns { required, minAge, restrictedVariantIds } — category
 * slugs are merchant data, not secrets, and the answer reveals
 * nothing beyond what the PDP gate already shows. The SERVER
 * re-derives the requirement from DB category slugs inside the
 * orders route at submit time and refuses without an attestation;
 * this endpoint only drives the form display (the rx-check
 * contract, ADV-22). Never an error for an unrestricted cart.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rate-limit";
import { evaluateAgeGateForVariants } from "@/catalog/age-restrictions";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  variantIds: z.array(z.string().min(1)).min(1).max(50),
});

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";
  const limit = await checkRateLimit(`age-check:${ip}`, 60, 60 * 1000);
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
  const result = await evaluateAgeGateForVariants(parsed.data.variantIds, false);
  return NextResponse.json({
    data: {
      required: result.required,
      minAge: result.minAge,
      restrictedVariantIds: result.restrictedVariantIds,
    },
  });
}
