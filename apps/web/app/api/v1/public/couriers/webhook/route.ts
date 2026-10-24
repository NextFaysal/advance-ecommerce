// Public courier webhook (sandbox) — Agent 9.
// POST /api/v1/public/couriers/webhook?provider=steadfast|pathao|redx
// Same contract as the payment webhook: raw body + HMAC signature verified
// first (unverified => logged, 401, never applied), idempotency key makes
// replays return duplicate:true without applying twice, and every attempt
// is logged in the sandbox store with a reason only.
// Body: { trackingId, rawStatus, idempotencyKey? }
// rawStatus is mapped per provider (sandbox/status-mapping.ts), the
// shipment status only moves forward (or to FAILED/RETURNING/RETURNED),
// and the linked order status only moves through the order state machine
// (canTransition) — an illegal order move is logged, not coerced.
// Secret: Admin Settings (encrypted) if configured, otherwise the local
// env SANDBOX_WEBHOOK_TEST_SECRET (sandbox only). No hardcoded secret.
import { NextResponse } from "next/server";
import { z } from "zod";
import { processWebhook, WEBHOOK_HEADERS } from "@/integrations/sandbox/webhook";
import {
  applyShipmentToOrderStatus,
  canApplyShipmentStatus,
  mapCourierRawStatus,
} from "@/integrations/sandbox/status-mapping";
import { sandboxStore } from "@/integrations/sandbox/store";
import { SANDBOX_COURIER_PROVIDERS } from "@/integrations/sandbox/courier-provider";
import { getSetting } from "@/lib/settings";

const bodySchema = z.object({
  trackingId: z.string().min(1),
  rawStatus: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
});

async function webhookSecret(provider: string): Promise<string | null> {
  try {
    const fromSettings = await getSetting(`courier.${provider}.webhook_secret`);
    if (fromSettings) return fromSettings;
  } catch {
    // Settings/DB not available in a pure sandbox run — fall through to env.
  }
  return process.env.SANDBOX_WEBHOOK_TEST_SECRET ?? null;
}

export async function POST(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  if (!(SANDBOX_COURIER_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Unknown or non-sandbox courier provider." } },
      { status: 400 },
    );
  }
  const rawBody = await req.text();
  let body: unknown = {};
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Webhook body must be JSON." } },
      { status: 400 },
    );
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid webhook body." } },
      { status: 400 },
    );
  }
  const idempotencyKey =
    req.headers.get(WEBHOOK_HEADERS.idempotencyKey) ?? parsed.data.idempotencyKey ?? null;
  if (!idempotencyKey) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "An idempotency key is required." } },
      { status: 400 },
    );
  }
  const secret = await webhookSecret(provider);
  const result = processWebhook({
    channel: "courier",
    provider,
    rawBody,
    signature: req.headers.get(WEBHOOK_HEADERS.signature),
    timestamp: req.headers.get(WEBHOOK_HEADERS.timestamp) ?? undefined,
    idempotencyKey,
    secret,
    apply: () => {
      const shipment = [...sandboxStore.shipments.values()].find(
        (s) => s.trackingId === parsed.data.trackingId && s.provider === provider,
      );
      if (!shipment) return { applied: false, reason: "shipment_not_found" };
      const mapped = mapCourierRawStatus(provider, parsed.data.rawStatus);
      if (mapped === null) return { applied: false, reason: "unknown_raw_status" };
      if (!canApplyShipmentStatus(shipment.status, mapped)) {
        return { applied: false, reason: `invalid_shipment_transition:${shipment.status}->${mapped}` };
      }
      shipment.status = mapped;
      shipment.statusHistory.push(mapped);
      const orderMove = applyShipmentToOrderStatus(shipment.orderStatus, mapped);
      if (orderMove.applied) shipment.orderStatus = orderMove.next;
      return { applied: true, reason: orderMove.reason };
    },
  });
  return NextResponse.json(
    {
      data: {
        verified: result.verified,
        duplicate: result.duplicate,
        applied: result.applied,
        reason: result.reason,
      },
      meta: { sandbox: true },
    },
    { status: result.httpStatus },
  );
}
