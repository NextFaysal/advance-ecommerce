import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { guardError, requireAdmin } from "@/reports/guard";
import { notFound } from "@/webhooks/admin-http";
import { processWebhookDelivery } from "@/webhooks/deliver";
import { dispatchTestPing } from "@/webhooks/dispatch";
import { toDeliveryView } from "@/webhooks/store";
import { recordDemoAudit } from "../../../../audit-log/store";

// Test ping — admin (ADV-26). Creates a webhook.test delivery for the
// endpoint, enqueues it for the worker AND attempts it in-process
// (the bulk-actions dual-trigger pattern: without a running worker
// the delivery log would otherwise sit PENDING and tell staff
// nothing). The returned delivery is the truth: status SENT only if
// the target really answered 2xx just now.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const ping = await dispatchTestPing(params.id);
  if (!ping) return notFound("Webhook endpoint");
  await processWebhookDelivery(ping.deliveryId).catch(() => null);
  const row = await prisma.webhookDelivery.findUnique({ where: { id: ping.deliveryId } });
  await recordDemoAudit({
    actorId: guard.userId,
    action: "webhooks.endpoint.test",
    entityType: "WebhookEndpoint",
    entityId: params.id,
    afterJson: { deliveryId: ping.deliveryId, status: row?.status ?? "PENDING" },
  });
  return NextResponse.json({
    data: { delivery: row ? toDeliveryView(row) : null },
    meta: {
      persistence: "database",
      note: "Test ping attempted immediately; the same delivery is also queued for the worker if this attempt did not finish it.",
    },
  });
}
