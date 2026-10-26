/**
 * GET /api/v1/public/site-status — the public site-status probe.
 *
 * Exists for the maintenance gate: Next middleware runs on the edge
 * and cannot read the DB Settings store, so it polls this route
 * (short TTL cache, fail-open) to learn whether maintenance mode is
 * on and which messages to render on the 503 page. The payload is
 * exactly what the 503 page displays to everyone — no config beyond
 * the public messages ever leaves through here.
 */
import { NextResponse } from "next/server";
import { getMaintenanceConfig } from "@/privacy/maintenance";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = await getMaintenanceConfig();
  return NextResponse.json({
    data: {
      maintenance: {
        enabled: config.enabled,
        messageBn: config.messageBn,
        messageEn: config.messageEn,
      },
    },
    meta: { source: "settings:site.maintenance" },
  });
}
