import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { notFound, validationError, webhookAdminError } from "@/webhooks/admin-http";
import { deleteEndpoint, updateEndpoint } from "@/webhooks/store";
import { recordDemoAudit } from "../../../audit-log/store";

// Webhook endpoint update / delete — admin (ADV-26).
// PATCH: name / url (SSRF re-validated) / events / enabled.
// DELETE: removes the endpoint; its deliveries cascade (FK).
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const schema = z.object({
    name: z.string().min(1).max(120).optional(),
    url: z.string().min(8).max(2000).optional(),
    events: z.array(z.string().min(1)).min(1).max(20).optional(),
    enabled: z.boolean().optional(),
  });
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  try {
    const endpoint = await updateEndpoint(params.id, parsed.data);
    if (!endpoint) return notFound("Webhook endpoint");
    await recordDemoAudit({
      actorId: guard.userId,
      action: "webhooks.endpoint.update",
      entityType: "WebhookEndpoint",
      entityId: endpoint.id,
      afterJson: { ...parsed.data },
    });
    return NextResponse.json({ data: { endpoint }, meta: { persistence: "database" } });
  } catch (error) {
    return webhookAdminError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const removed = await deleteEndpoint(params.id);
  if (!removed) return notFound("Webhook endpoint");
  await recordDemoAudit({
    actorId: guard.userId,
    action: "webhooks.endpoint.delete",
    entityType: "WebhookEndpoint",
    entityId: params.id,
  });
  return NextResponse.json({ data: { deleted: true }, meta: { persistence: "database" } });
}
