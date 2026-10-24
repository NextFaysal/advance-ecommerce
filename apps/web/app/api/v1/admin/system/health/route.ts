import { NextResponse } from "next/server";
import { cookies } from "next/headers";

// GET /api/v1/admin/system/health — hardening base stub (Agent 10, Step 35).
// Rules: admin_session cookie required (401 without it), response contains
// ONLY booleans + a status word. Never return a URL, host, key name value,
// or error message from a downstream service — those leak infrastructure.
// Real checks (DB ping, Redis ping, queue depth, provider test-connection)
// land with the settings service; until then every check is false, which is
// the honest state while Prisma generate / Redis wiring are pending.
export async function GET() {
  if (!cookies().get("admin_session")?.value) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Admin login required." } }, { status: 401 });
  }
  const checks = {
    database: false,
    redis: false,
    queue: false,
    paymentProviderConfigured: false,
    courierProviderConfigured: false,
    search: false,
    storage: false,
  };
  const healthy = Object.values(checks).every(Boolean);
  return NextResponse.json({
    data: { status: healthy ? "ok" : "degraded", checks, checkedAt: new Date().toISOString() },
    meta: { stub: true, pending: "prisma-generate, redis, provider test-connection" },
  });
}
