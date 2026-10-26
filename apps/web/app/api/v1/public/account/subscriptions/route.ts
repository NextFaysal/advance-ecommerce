/**
 * Customer subscriptions (ADV-18 remainder), gated by the
 * module.subscriptions feature flag.
 *
 * GET  — the signed-in customer's own subscriptions + their saved
 *        addresses (create-form snapshot sources) + the configured
 *        Subscribe & Save discount bps.
 * POST — create a subscription: variant + quantity + interval +
 *        address (addressId of one of the customer's saved addresses,
 *        or an inline bdAddress). COD only in v1 (see the service
 *        header in src/subscriptions/service.ts).
 *
 * Flag OFF -> 403 FEATURE_LOCKED on both verbs: a locked module never
 * runs open. Ownership comes from the customer session only — no
 * customer id is ever accepted from the request.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { bdAddressSchema } from "@/checkout/validation";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import {
  SUBSCRIPTION_INTERVALS,
  createSubscription,
  listCustomerAddressOptions,
  listSubscriptionsForCustomer,
  loadSubscriptionDiscountBps,
} from "@/subscriptions/service";
import { prisma } from "@advance-ecommerce/db";

export const dynamic = "force-dynamic";

function locked() {
  return errorResponse(
    "FEATURE_LOCKED",
    "সাবস্ক্রিপশন সুবিধাটি এই দোকানে চালু নেই। / Subscriptions are not enabled for this store.",
    403,
  );
}

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  if (!subscriptionsEnabled()) return locked();
  const [subscriptions, addresses, discountBps] = await Promise.all([
    listSubscriptionsForCustomer(customer.id),
    listCustomerAddressOptions(customer.id),
    loadSubscriptionDiscountBps(),
  ]);
  return NextResponse.json({
    data: { subscriptions, addresses, discountBps },
    meta: { db: "PRISMA" },
  });
}

const createSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  interval: z.enum(SUBSCRIPTION_INTERVALS),
  addressId: z.string().min(1).optional(),
  address: bdAddressSchema.optional(),
});

export async function POST(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  if (!subscriptionsEnabled()) return locked();

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse("INVALID_INPUT", "সঠিক তথ্য দিন। / Please provide valid subscription details.", 400, parsed.error.issues);
  }
  const body = parsed.data;

  // Resolve the address snapshot: a saved address (ownership-checked)
  // or the inline form — never a bare id trusted from the client.
  let address: { division: string; district: string; upazila: string; union?: string | null; addressLine: string } | null =
    body.address ?? null;
  if (body.addressId !== undefined) {
    const saved = await prisma.address.findFirst({
      where: { id: body.addressId, customerId: customer.id },
      select: { division: true, district: true, upazila: true, union: true, addressLine: true },
    });
    if (saved === null) {
      return errorResponse("ADDRESS_NOT_FOUND", "সংরক্ষিত ঠিকানাটি পাওয়া যায়নি। / The saved address was not found.", 400);
    }
    address = saved;
  }
  if (address === null) {
    return errorResponse(
      "ADDRESS_REQUIRED",
      "ডেলিভারির ঠিকানা দিন অথবা সংরক্ষিত ঠিকানা বেছে নিন। / Provide a delivery address or choose a saved one.",
      400,
    );
  }

  const result = await createSubscription({
    customerId: customer.id,
    variantId: body.variantId,
    quantity: body.quantity,
    interval: body.interval,
    address,
  });
  if (!result.ok) {
    return errorResponse(result.code, result.message, 400);
  }
  return NextResponse.json({ data: { subscription: result.view }, meta: { db: "PRISMA" } }, { status: 201 });
}
