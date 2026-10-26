import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { guardError, requireAdmin } from "@/reports/guard";
import { notFound } from "@/webhooks/admin-http";
import { processWebhookDelivery } from "@/webhooks/deliver";
import { enqueueWebhookDelivery } from "@/webhooks/dispatch";
import { resetDeliveryForRedeliver, toDeliveryView } from "@/webhooks/store";
import { recordDemoAudit } from "../../../../audit-log/store";

// Manual redeliver — admin (ADV-26). Resets a FAILED/DEAD/PENDING
// delivery to PENDING with a fresh attempt budget, re-enqueues it,
// and attempts it in-process once (dual trigger, same as test ping).
// A SENT delivery is final: redeliver answers 409.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const reset = await resetDeliveryForRedeliver(params.id);
  if (!reset) return notFound("Webhook delivery");
  if (reset.status === "SENT") {
    return NextResponse.json(
      { error: { code: "ALREADY_DELIVERED", message: "This delivery already succeeded (2xx) and is final." } },
      { status: 409 },
    );
  }
  await enqueueWebhookDelivery(reset).catch(() => false);
  await processWebhookDelivery(reset.id).catch(() => null);
  const row = await prisma.webhookDelivery.findUnique({ where: { id: reset.id } });
  await recordDemoAudit({
    actorId: guard.userId,
    action: "webhooks.delivery.redeliver",
    entityType: "WebhookDelivery",
    entityId: reset.id,
    afterJson: { status: row?.status ?? reset.status },
  });
  return NextResponse.json({
    data: { delivery: row ? toDeliveryView(row) : toDeliveryView(reset) },
    meta: { persistence: "database" },
  });
}
