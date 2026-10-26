import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { getIntegrationConfigWithSecrets, getIntegrationStatus, getSetting } from "@/lib/settings";
import { SMS_PROVIDERS, type SmsProviderName } from "@/integrations/sms";
import {
  buildConfiguredSmsProvider,
  diagnoseSmsProvider,
  type SmsSettingsReader,
} from "@/integrations/sms-resolver";
import { SmsProviderError } from "@/integrations/sms-providers";

// POST /api/v1/admin/settings/test — contract in src/integrations/sandbox/SETTINGS-API-CONTRACT.md
// Sandbox: succeeds without any credential, reported as sandbox (simulated, no real provider call).
// Live: requires a configured credential reference; real provider test is NOT faked —
// if configured, returns 503 until the real adapter test is implemented in the provider slice.
// SMS (ADV-2): the real adapters EXIST, so the sms branch in POST is a REAL balance
// probe against the named provider (never the fallback): unconfigured -> 422 with
// the missing pieces named, provider rejection -> 502 with the provider's code.
// No credential value is ever returned or logged.
const bodySchema = z.object({
  category: z.enum(["payment", "courier", "sms"]),
  provider: z.string().min(1).max(50),
});

const PROVIDERS: Record<string, readonly string[]> = {
  payment: ["cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay", "stripe", "paypal"],
  courier: ["steadfast", "pathao", "redx", "paperfly", "ecourier"],
  sms: [...SMS_PROVIDERS],
};

/** ADV-2 real balance probe for one SMS provider (see header). */
async function testSmsProvider(provider: SmsProviderName) {
  const reader: SmsSettingsReader = {
    getSetting: (key) => getSetting(key),
    getProviderSecrets: (name) => getIntegrationConfigWithSecrets("sms", name),
  };
  const diagnosis = await diagnoseSmsProvider(reader, provider);
  if (!diagnosis.configured) {
    const reasons: string[] = [];
    if (!diagnosis.enabled) reasons.push(`sms.${provider}.enabled is not "true"`);
    if (diagnosis.missingFields.length > 0) {
      reasons.push(`missing credential field(s): ${diagnosis.missingFields.join(", ")}`);
    }
    return NextResponse.json(
      { error: { code: "SMS_NOT_CONFIGURED", message: `${provider} is not configured — ${reasons.join("; ")}.` } },
      { status: 422 },
    );
  }
  const gateway = await buildConfiguredSmsProvider(reader, provider);
  if (gateway === null) {
    return NextResponse.json(
      { error: { code: "SMS_NOT_CONFIGURED", message: `${provider} could not be built from Settings.` } },
      { status: 422 },
    );
  }
  try {
    const balance = await gateway.getBalance();
    return NextResponse.json({
      data: {
        ok: true,
        status: "connected",
        provider,
        balancePoisha: balance.balancePoisha,
        currency: balance.currency,
        message: `${provider} balance check succeeded (real provider call).`,
      },
    });
  } catch (e) {
    if (e instanceof SmsProviderError) {
      return NextResponse.json(
        { error: { code: "SMS_PROVIDER_ERROR", message: e.message, details: { providerCode: e.code } } },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: { code: "SMS_PROVIDER_ERROR", message: `${provider} balance check failed unexpectedly.` } },
      { status: 502 },
    );
  }
}

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
  if (category === "sms") {
    // ADV-2: real balance probe — must run BEFORE the generic mode
    // logic below, which would otherwise read a non-existent
    // sms.<provider>.mode key, default to "sandbox" and fake a pass.
    try {
      return await testSmsProvider(provider as SmsProviderName);
    } catch {
      return NextResponse.json(
        { error: { code: "DB_NOT_READY", message: "SMS settings could not be read (Settings store unavailable)." } },
        { status: 503 },
      );
    }
  }
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
