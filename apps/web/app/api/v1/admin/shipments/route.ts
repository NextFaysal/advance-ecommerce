// Admin shipment booking — Agent 9, Step 22; ADV-5 resolver.
// POST /api/v1/admin/shipments (shipments.book)
// Body follows CreateShipmentInput (../courier.ts): orderId, provider
// (steadfast|pathao|redx|paperfly|ecourier), address,
// codAmountPoisha (integer poisha), weightGrams, itemCount, note,
// idempotencyKey.
// Each provider resolves through its own Settings-driven resolver
// (src/integrations/<provider>-resolver.ts): when courier.<provider>
// is enabled AND carries its full credential set in encrypted
// Settings, the booking is REAL (live provider API) and the response
// says so (meta.live: true, meta.sandbox: false). For
// steadfast/pathao/redx every other case is the sandbox provider's
// booking: the tracking id is SBX-prefixed, no real courier is
// contacted, and meta.sandbox stays true. paperfly/ecourier have NO
// sandbox booking provider, so an unconfigured booking for them is
// refused honestly (422 COURIER_NOT_CONFIGURED) instead of being
// simulated. Replaying the same idempotencyKey returns the original
// shipment instead of booking twice.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
  type SandboxCourierProvider,
} from "@/integrations/sandbox/courier-provider";
import {
  COURIER_PROVIDERS,
  type CourierProvider,
  type CourierProviderName,
} from "@/integrations/courier";
import { resolveSteadfastCourier } from "@/integrations/steadfast-resolver";
import { resolvePathaoCourier } from "@/integrations/pathao-resolver";
import { resolveRedxCourier } from "@/integrations/redx-resolver";
import { resolvePaperflyCourier } from "@/integrations/paperfly-resolver";
import { resolveEcourierCourier } from "@/integrations/ecourier-resolver";
import { getIntegrationConfigWithSecrets, getSetting } from "@/lib/settings";

const bodySchema = z.object({
  orderId: z.string().min(1),
  provider: z.enum(COURIER_PROVIDERS as unknown as [CourierProviderName, ...CourierProviderName[]]),
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
    // Sandbox default exists only for the original three providers;
    // paperfly/ecourier start at null and MUST resolve live (below).
    let provider: CourierProvider | null = (
      SANDBOX_COURIER_PROVIDERS as readonly string[]
    ).includes(parsed.data.provider)
      ? createSandboxCourierProvider(parsed.data.provider as SandboxCourierProvider)
      : null;
    let live = false;
    // ADV-5: a configured live adapter wins; anything else (not
    // enabled, credentials missing, settings unreadable) keeps the
    // sandbox provider where one exists — and the response keeps
    // saying so.
    const reader = {
      getSetting: (key: string) => getSetting(key),
      getProviderSecrets: (name: string) => getIntegrationConfigWithSecrets("courier", name),
    };
    const liveResolvers: Record<CourierProviderName, () => Promise<{ provider: CourierProvider } | null>> = {
      steadfast: () => resolveSteadfastCourier(reader),
      pathao: () => resolvePathaoCourier(reader),
      redx: () => resolveRedxCourier(reader),
      paperfly: () => resolvePaperflyCourier(reader),
      ecourier: () => resolveEcourierCourier(reader),
    };
    const resolved = await liveResolvers[parsed.data.provider]().catch(() => null);
    if (resolved !== null) {
      provider = resolved.provider;
      live = true;
    }
    if (provider === null) {
      // paperfly/ecourier unconfigured: no sandbox booking exists for
      // them — refuse honestly instead of simulating a booking.
      return NextResponse.json(
        {
          error: {
            code: "COURIER_NOT_CONFIGURED",
            message: `${parsed.data.provider} live courier is not configured (Admin Settings courier.${parsed.data.provider}.*) and this provider has no sandbox booking fallback.`,
          },
        },
        { status: 422 },
      );
    }
    const result = await provider.createShipment(parsed.data);
    return NextResponse.json({
      data: result,
      meta: live ? { sandbox: false, live: true, provider: parsed.data.provider } : { sandbox: true },
    });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "BOOKING_FAILED", message: error instanceof Error ? error.message : "Booking failed." } },
      { status: 409 },
    );
  }
}
