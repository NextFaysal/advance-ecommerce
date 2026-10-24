// Admin sandbox tracking lookup — Agent 9.
// GET /api/v1/admin/shipments/track?trackingId=SBX-..&provider=steadfast|pathao|redx
// Permission: shipments.view. Provider is required because tracking ids
// are looked up per provider in the sandbox store.
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/integrations/sandbox/admin-auth";
import {
  createSandboxCourierProvider,
  SANDBOX_COURIER_PROVIDERS,
  type SandboxCourierProvider,
} from "@/integrations/sandbox/courier-provider";

export async function GET(req: Request) {
  const guard = await requireAdminPermission("shipments.view");
  if (!guard.ok) {
    return NextResponse.json(
      { error: { code: guard.code, message: guard.message } },
      { status: guard.httpStatus },
    );
  }
  const url = new URL(req.url);
  const trackingId = url.searchParams.get("trackingId");
  const providerName = url.searchParams.get("provider");
  if (!trackingId || !(SANDBOX_COURIER_PROVIDERS as readonly string[]).includes(providerName ?? "")) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "trackingId and a sandbox provider are required." } },
      { status: 400 },
    );
  }
  try {
    const provider = createSandboxCourierProvider(providerName as SandboxCourierProvider);
    const result = await provider.getStatus(trackingId);
    return NextResponse.json({ data: { trackingId, ...result }, meta: { sandbox: true } });
  } catch (error) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: error instanceof Error ? error.message : "Not found." } },
      { status: 404 },
    );
  }
}
