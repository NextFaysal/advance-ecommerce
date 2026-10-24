import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { getIntegrationStatus, getSetting } from "@/lib/settings";

// POST /api/v1/admin/settings/test — contract in src/integrations/sandbox/SETTINGS-API-CONTRACT.md
// Sandbox: succeeds without any credential, reported as sandbox (simulated, no real provider call).
// Live: requires a configured credential reference; real provider test is NOT faked —
// if configured, returns 503 until the real adapter test is implemented in the provider slice.
const bodySchema = z.object({
  category: z.enum(["payment", "courier"]),
  provider: z.string().min(1).max(50),
});

const PROVIDERS: Record<string, readonly string[]> = {
  payment: ["cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay", "stripe", "paypal"],
  courier: ["steadfast", "pathao", "redx", "paperfly", "ecourier"],
};

export async function POST(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Login required." } }, { status: 401 });
  }
  const session = await validateSessionToken(token).catch(() => null);
  if (!session) {
    return NextResponse.json({ error: { code: "DB_NOT_READY", message: "Session validation unavailable (Prisma pending)." } }, { status: 503 });
  }
  if (!hasPermission(session.user.permissions, "settings.integrations")) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: "settings.integrations permission required." } }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success || !(PROVIDERS[parsed.data.category] as readonly string[]).includes(parsed.data.provider)) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Unknown category/provider." } }, { status: 400 });
  }
  const { category, provider } = parsed.data;
  let mode = "sandbox";
  try {
    mode = (await getSetting(`${category}.${provider}.mode`)) ?? "sandbox";
  } catch {
    mode = "sandbox";
  }
  if (mode !== "live") {
    return NextResponse.json({ data: { ok: true, status: "configured", message: "Sandbox test passed (simulated, no real provider call)." } });
  }
  let configured = false;
  try {
    const status = await getIntegrationStatus(category, [provider]);
    configured = status[0]?.configured ?? false;
  } catch {
    configured = false;
  }
  if (!configured) {
    return NextResponse.json({ error: { code: "LIVE_NOT_CONFIGURED", message: "Live mode requires a verified credential in Admin Settings." } }, { status: 422 });
  }
  return NextResponse.json(
    { error: { code: "LIVE_TEST_NOT_IMPLEMENTED", message: "Live provider test will run when the real adapter is implemented. No test was faked." } },
    { status: 503 },
  );
}
