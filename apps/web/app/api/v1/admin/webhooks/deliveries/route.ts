import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { listDeliveries } from "@/webhooks/store";

// Delivery log — admin (ADV-26). Read-only view over the durable
// WebhookDelivery rows: status filter + endpoint filter. A delivery
// shows SENT only when the target really answered 2xx.
export async function GET(req: Request) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const endpointId = url.searchParams.get("endpointId") ?? undefined;
  const limitRaw = Number(url.searchParams.get("limit") ?? "50");
  const deliveries = await listDeliveries({
    status: status || undefined,
    endpointId: endpointId || undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : 50,
  });
  return NextResponse.json({
    data: { deliveries },
    meta: { persistence: "database" },
  });
}
