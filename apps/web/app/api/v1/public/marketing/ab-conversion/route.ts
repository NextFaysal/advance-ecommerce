import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { recordConversionForOrder, VISITOR_COOKIE } from "@/marketing/experiments";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ orderId: z.string().min(1).max(64) }).strict();

/**
 * POST /api/v1/public/marketing/ab-conversion { orderId }
 * Fired by the checkout confirmation. The variant is derived
 * server-side from the visitor cookie — the client cannot claim a
 * variant — and the order must exist. Records at most one
 * conversion per experiment per order.
 */
export async function POST(req: Request) {
  if (!marketingMechanicsEnabled()) {
    return NextResponse.json({ data: { recorded: [] }, meta: { feature: "off" } });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "orderId required" } }, { status: 400 });
  }
  const visitorId = (await cookies()).get(VISITOR_COOKIE)?.value ?? null;
  const recorded = await recordConversionForOrder(visitorId, parsed.data.orderId).catch(() => []);
  return NextResponse.json({ data: { recorded }, meta: { countedVia: "TrackingEvent AB:<exp>:<variant>:conversion" } });
}
