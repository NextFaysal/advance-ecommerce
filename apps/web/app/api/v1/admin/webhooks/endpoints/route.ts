import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { validationError, webhookAdminError } from "@/webhooks/admin-http";
import { WEBHOOK_EVENTS } from "@/webhooks/events";
import { createEndpoint, listEndpoints } from "@/webhooks/store";
import { recordDemoAudit } from "../../audit-log/store";

// Webhook endpoints — admin (ADV-26).
// Guard: settings.integrations (the integrations-level permission in
// the RBAC catalogue — the same one the Modules page uses).
// GET: list endpoints (secret shown as prefix only — the plaintext
//      exists in exactly one response: the create below).
// POST: create; the response carries the signing secret ONCE. It is
//      stored AES-encrypted (worker must sign with it) and the audit
//      snapshot contains no secret material.
export async function GET() {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const endpoints = await listEndpoints();
  return NextResponse.json({
    data: { endpoints, eventCatalogue: WEBHOOK_EVENTS },
    meta: {
      persistence: "database",
      note: "Signing secrets are encrypted at rest and shown once at creation; only the prefix is listed here.",
    },
  });
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().min(8).max(2000),
  events: z.array(z.string().min(1)).min(1).max(20),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  try {
    const endpoint = await createEndpoint({
      name: parsed.data.name,
      url: parsed.data.url,
      events: parsed.data.events,
      createdById: guard.userId,
    });
    await recordDemoAudit({
      actorId: guard.userId,
      action: "webhooks.endpoint.create",
      entityType: "WebhookEndpoint",
      entityId: endpoint.id,
      afterJson: { name: endpoint.name, url: endpoint.url, events: endpoint.events },
    });
    return NextResponse.json(
      {
        data: { endpoint },
        meta: {
          persistence: "database",
          note: "The signing secret (endpoint.secret) is shown ONCE — copy it now; it cannot be recovered, only rotated by deleting and recreating the endpoint.",
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return webhookAdminError(error);
  }
}
