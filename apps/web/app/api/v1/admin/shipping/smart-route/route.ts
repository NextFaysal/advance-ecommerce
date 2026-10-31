import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { calculateSmartRoute, type RoutingStrategy } from "@/integrations/smart-routing";

const querySchema = z.object({
  division: z.string().optional(),
  district: z.string().default("Dhaka"),
  upazila: z.string().optional(),
  weightGrams: z.coerce.number().optional().default(500),
  codAmountPoisha: z.coerce.number().optional().default(0),
  strategy: z.enum(["balanced", "max_delivery", "cheapest", "fastest"]).optional().default("balanced"),
});

export async function GET(request: Request) {
  // Admin-only like every sibling route under /api/v1/admin (added in
  // review of 590a2da4 — the handler takes only query params and reads
  // no private data, but the admin namespace is authenticated by
  // convention and this endpoint is not a public calculator).
  const guard = await requireAdmin("orders.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));

    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "INVALID_QUERY", message: "ভুল প্যারামিটার পাঠানো হয়েছে", details: parsed.error.issues } },
        { status: 400 },
      );
    }

    const decision = calculateSmartRoute({
      division: parsed.data.division,
      district: parsed.data.district,
      upazila: parsed.data.upazila,
      weightGrams: parsed.data.weightGrams,
      codAmountPoisha: parsed.data.codAmountPoisha,
      strategy: parsed.data.strategy as RoutingStrategy,
    });

    return NextResponse.json({ data: decision });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: {
          code: "SMART_ROUTING_FAILED",
          message: err instanceof Error ? err.message : "স্মার্ট কুরিয়ার রাউটিং সম্পন্ন করা যায়নি",
        },
      },
      { status: 500 },
    );
  }
}
