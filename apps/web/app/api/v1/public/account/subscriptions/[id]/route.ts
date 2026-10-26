/**
 * PATCH /api/v1/public/account/subscriptions/[id] — manage ONE of the
 * signed-in customer's own subscriptions (ADV-18 remainder):
 * pause / resume / cancel, change interval, change quantity.
 *
 * Ownership is enforced inside the service (the lookup filters on
 * customerId), so another customer's id reads as NOT_FOUND — this
 * route adds only session + flag + input validation.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import { SUBSCRIPTION_INTERVALS, updateSubscriptionForCustomer } from "@/subscriptions/service";
import { isValidQtyNumber } from "@/lib/quantity";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum(["pause", "resume", "cancel"]).optional(),
  interval: z.enum(SUBSCRIPTION_INTERVALS).optional(),
  quantity: z
    .number()
    .refine((v) => isValidQtyNumber(v) && v <= 99, "Quantity must be positive (max 99, up to 3 decimals)")
    .optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  if (!subscriptionsEnabled()) {
    return errorResponse(
      "FEATURE_LOCKED",
      "সাবস্ক্রিপশন সুবিধাটি এই দোকানে চালু নেই। / Subscriptions are not enabled for this store.",
      403,
    );
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("INVALID_INPUT", "সঠিক তথ্য দিন। / Please provide valid changes.", 400, parsed.error.issues);
  }
  const result = await updateSubscriptionForCustomer({
    customerId: customer.id,
    subscriptionId: params.id,
    action: parsed.data.action,
    interval: parsed.data.interval,
    quantity: parsed.data.quantity,
  });
  if (!result.ok) {
    const status = result.code === "NOT_FOUND" ? 404 : 400;
    return errorResponse(result.code, result.message, status);
  }
  return NextResponse.json({ data: { subscription: result.view }, meta: { db: "PRISMA" } });
}
