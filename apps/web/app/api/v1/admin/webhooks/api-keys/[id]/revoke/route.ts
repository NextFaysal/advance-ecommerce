import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { revokePartnerApiKey } from "@/webhooks/api-keys";
import { notFound } from "@/webhooks/admin-http";
import { recordDemoAudit } from "../../../../audit-log/store";

// Revoke a partner API key — admin (ADV-26). Immediate and final:
// authenticatePartnerKey refuses revoked keys on the next call.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const revoked = await revokePartnerApiKey(params.id);
  if (!revoked) return notFound("API key (or already revoked)");
  await recordDemoAudit({
    actorId: guard.userId,
    action: "webhooks.api_key.revoke",
    entityType: "ApiKey",
    entityId: params.id,
  });
  return NextResponse.json({ data: { revoked: true }, meta: { persistence: "database" } });
}
