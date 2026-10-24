// Admin sandbox shipment cancel — Agent 9.
// POST /api/v1/admin/shipments/cancel (shipments.cancel)
// Body { shipmentId, provider }. Sandbox rule: only a CREATED shipment
// can be cancelled, and it maps to FAILED (ShipmentStatus has no
// CANCELLED — see sandbox/courier-provider.ts).
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import { findShipmentById } from "@/integrations/sandbox/db-store";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
  type SandboxCourierProvider,
} from "@/integrations/sandbox/courier-provider";

const bodySchema = z.object({
  shipmentId: z.string().min(1),
  provider: z.enum(SANDBOX_COURIER_PROVIDERS).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdminPermission("shipments.cancel");
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
      { error: { code: "INVALID_INPUT", message: "shipmentId is required." } },
      { status: 400 },
    );
  }
  const shipment = await findShipmentById(parsed.data.shipmentId);
  if (!shipment) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "Sandbox shipment not found." } },
      { status: 404 },
    );
  }
  const providerName = (parsed.data.provider ?? shipment.provider) as SandboxCourierProvider;
  if (!(SANDBOX_COURIER_PROVIDERS as readonly string[]).includes(providerName)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Provider is not a sandbox courier." } },
      { status: 400 },
    );
  }
  try {
    const provider = createSandboxCourierProvider(providerName);
    const result = await provider.cancelShipment(parsed.data.shipmentId);
    return NextResponse.json({ data: result, meta: { sandbox: true } });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "CANCEL_FAILED", message: error instanceof Error ? error.message : "Cancel failed." } },
      { status: 409 },
    );
  }
}
