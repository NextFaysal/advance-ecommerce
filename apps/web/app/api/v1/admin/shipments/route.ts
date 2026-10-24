// Admin sandbox shipment booking — Agent 9, Step 22.
// POST /api/v1/admin/shipments (shipments.book)
// Body follows CreateShipmentInput (../courier.ts): orderId, provider
// (steadfast|pathao|redx in sandbox), address, codAmountPoisha (integer
// poisha), weightGrams, itemCount, note, idempotencyKey.
// Simulated booking only: the tracking id returned is SBX-prefixed and no
// real courier is contacted. Replaying the same idempotencyKey returns
// the original shipment instead of booking twice.
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
} from "@/integrations/sandbox/courier-provider";

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
    const provider = createSandboxCourierProvider(parsed.data.provider);
    const result = await provider.createShipment(parsed.data);
    return NextResponse.json({ data: result, meta: { sandbox: true } });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "BOOKING_FAILED", message: error instanceof Error ? error.message : "Booking failed." } },
      { status: 409 },
    );
  }
}
