/**
 * GET /api/v1/public/push/config — the VAPID public key the browser
 * needs to create a push subscription, and whether push sending is
 * configured at all. The public key is not a secret (it ships to every
 * subscribing browser); the private key never leaves the server env.
 * When push is NOT_CONFIGURED the client UI says so honestly instead
 * of offering a subscribe button that could never receive anything.
 */
import { NextResponse } from "next/server";
import { getVapidConfig } from "@/platform/push-server";

export async function GET() {
  const config = getVapidConfig();
  return NextResponse.json({
    data: {
      configured: config !== null,
      publicKey: config?.publicKey ?? null,
    },
    meta: { source: "env:WEB_PUSH_VAPID_*" },
  });
}
