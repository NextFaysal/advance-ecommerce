import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { createPartnerApiKey, listPartnerApiKeys, PARTNER_SCOPES } from "@/webhooks/api-keys";
import { validationError, webhookAdminError } from "@/webhooks/admin-http";
import { recordDemoAudit } from "../../audit-log/store";

// Partner API keys — admin (ADV-26). Guard: settings.integrations.
// GET: list keys (prefix + scopes only — plaintext never stored).
// POST: create; the response carries the key ONCE (ae_live_…).
export async function GET() {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const apiKeys = await listPartnerApiKeys();
  return NextResponse.json({
    data: { apiKeys, scopeCatalogue: PARTNER_SCOPES },
    meta: {
      persistence: "database",
      note: "Only SHA-256 hashes are stored; a key's plaintext is shown once at creation.",
    },
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1)).min(1).max(10),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  try {
    const apiKey = await createPartnerApiKey({
      name: parsed.data.name,
      scopes: parsed.data.scopes,
      createdById: guard.userId,
    });
    await recordDemoAudit({
      actorId: guard.userId,
      action: "webhooks.api_key.create",
      entityType: "ApiKey",
      entityId: apiKey.id,
      afterJson: { name: apiKey.name, keyPrefix: apiKey.keyPrefix, scopes: apiKey.scopes },
    });
    return NextResponse.json(
      {
        data: { apiKey },
        meta: {
          persistence: "database",
          note: "The API key (apiKey.key) is shown ONCE — copy it now; it cannot be recovered, only revoked and reissued.",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return webhookAdminError(error);
  }
}
