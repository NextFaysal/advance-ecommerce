// Admin shipment booking — Agent 9, Step 22; ADV-5 part 1 resolver.
// POST /api/v1/admin/shipments (shipments.book)
// Body follows CreateShipmentInput (../courier.ts): orderId, provider
// (steadfast|pathao|redx), address, codAmountPoisha (integer
// poisha), weightGrams, itemCount, note, idempotencyKey.
// Steadfast resolves through src/integrations/steadfast-resolver.ts:
// when courier.steadfast is enabled AND carries api_key + secret_key
// in encrypted Settings, the booking is REAL (live Steadfast API) and
// the response says so (meta.live: true, meta.sandbox: false). In
// every other case — and for pathao/redx, which have no live adapter
// yet — the booking is the sandbox provider's: the tracking id is
// SBX-prefixed, no real courier is contacted, and meta.sandbox stays
// true. Replaying the same idempotencyKey returns the original
// shipment instead of booking twice.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
} from "@/integrations/sandbox/courier-provider";
import type { CourierProvider } from "@/integrations/courier";
import { resolveSteadfastCourier } from "@/integrations/steadfast-resolver";
import { getIntegrationConfigWithSecrets, getSetting } from "@/lib/settings";

const bodySchema = z.object({
  orderId: z.string().min(1),
  provider: z.enum(SANDBOX_COURIER_PROVIDERS),
  address: z.object({
    recipientName: z.string().min(1),
    recipientPhone: z.string().min(11).max(15),
    division: z.string().min(1),
    district: z.string().min(1),
    upazila: z.string().min(1),
    union: z.string().nullable(),
    addressLine: z.string().min(1),
  }),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  note: z.string().nullable(),
  idempotencyKey: z.string().min(1),
});

export async function POST(req: Request) {
  const guard = await requireAdminPermission("shipments.book");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid shipment booking input." } },
      { status: 400 },
    );
  }
  try {
    let provider: CourierProvider = createSandboxCourierProvider(parsed.data.provider);
    let live = false;
    if (parsed.data.provider === "steadfast") {
      // ADV-5 part 1: configured live Steadfast wins; anything else
      // (not enabled, credentials missing, settings unreadable) keeps
      // the sandbox provider — and the response keeps saying so.
      const resolved = await resolveSteadfastCourier({
        getSetting: (key) => getSetting(key),
        getProviderSecrets: (name) => getIntegrationConfigWithSecrets("courier", name),
      }).catch(() => null);
      if (resolved !== null) {
        provider = resolved.provider;
        live = true;
      }
    }
    const result = await provider.createShipment(parsed.data);
    return NextResponse.json({
      data: result,
      meta: live ? { sandbox: false, live: true, provider: "steadfast" } : { sandbox: true },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "BOOKING_FAILED", message: error instanceof Error ? error.message : "Booking failed." } },
      { status: 409 },
    );
  }
}
