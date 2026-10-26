import { NextResponse } from "next/server";
import { z } from "zod";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { performSpin, type SpinIdentity } from "@/marketing/spin";
import { requireCustomer } from "@/customer-auth/http";
import { normalizeBdPhone } from "@/checkout/validation";

export const dynamic = "force-dynamic";

const spinBodySchema = z.object({ phone: z.string().min(1).max(32).optional() }).strict();

function errorResponse(code: string, message: string, status: number, meta?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message }, ...(meta ? { meta } : {}) }, { status });
}

/**
 * POST /api/v1/public/marketing/spin — one server-decided spin.
 * Identity: the signed-in customer when a session exists, else a
 * BD phone the visitor supplies (the daily limit binds to it).
 * The outcome is picked server-side from the configured weights
 * (see src/marketing/spin.ts); the client only animates.
 */
export async function POST(req: Request) {
  if (!marketingMechanicsEnabled()) {
    return errorResponse("FEATURE_LOCKED", "এই সুবিধাটি এখন উপলব্ধ নয়।", 404);
  }
  let body: z.infer<typeof spinBodySchema> = {};
  try {
    const raw: unknown = await req.json().catch(() => ({}));
    const parsed = spinBodySchema.safeParse(raw);
    if (parsed.success) body = parsed.data;
  } catch {
    body = {};
  }

  let identity: SpinIdentity | null = null;
  const customer = await requireCustomer().catch(() => null);
  if (customer !== null) {
    identity = { kind: "customer", customerId: customer.id };
  } else if (body.phone !== undefined) {
    const phone = normalizeBdPhone(body.phone);
    if (phone === null) {
      return errorResponse("INVALID_PHONE", "সঠিক মোবাইল নম্বর দিন (01XXXXXXXXX)।", 400);
    }
    identity = { kind: "phone", phone };
  }
  if (identity === null) {
    return errorResponse("IDENTITY_REQUIRED", "স্পিন করতে লগইন করুন অথবা মোবাইল নম্বর দিন।", 401);
  }

  const result = await performSpin(identity);
  if (!result.ok) {
    const status = result.code === "LIMIT_REACHED" ? 429 : 409;
    return NextResponse.json(
      {
        error: { code: result.code, message: result.message },
        meta: { spinsLeftToday: result.spinsLeftToday ?? null, counterBackend: result.counterBackend ?? null },
      },
      { status },
    );
  }
  return NextResponse.json({
    data: {
      spinId: result.spinId,
      outcome: result.outcome,
      segment: result.segment,
      award: result.award,
      spinsUsedToday: result.spinsUsedToday,
      spinsLeftToday: result.spinsLeftToday,
    },
    meta: { counterBackend: result.counterBackend, decision: "server_weighted_csprng" },
  });
}
