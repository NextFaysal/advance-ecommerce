// Public courier webhook (sandbox) — Agent 9.
// POST /api/v1/public/couriers/webhook?provider=steadfast|pathao|redx
// Same contract as the payment webhook: raw body + HMAC signature verified
// first (unverified => logged, 401, never applied), idempotency key makes
// replays return duplicate:true without applying twice, and every attempt
// is logged with a reason only.
// Body: { trackingId, rawStatus, idempotencyKey? }
// rawStatus is mapped per provider (sandbox/status-mapping.ts), the
// shipment status only moves forward (or to FAILED/RETURNING/RETURNED),
// and the linked order status is only ever READ here (for the transition
// check in status-mapping.ts) — applying an order transition stays with
// the orders module, which owns the order state machine; nothing in this
// route writes Order rows.
// Secret: Admin Settings (encrypted) if configured, otherwise the local
// env SANDBOX_WEBHOOK_TEST_SECRET (sandbox only). No hardcoded secret.
// Persistence: DB-backed (2026-10-24) — the mapped status updates the
// Shipment row and appends a ShipmentEvent carrying the webhook
// idempotency key (UNIQUE — the DB backstop against a replayed webhook
// applying twice, even across process restarts).
import { NextResponse } from "next/server";
import { z } from "zod";
import { processWebhook, WEBHOOK_HEADERS } from "@/integrations/sandbox/webhook";
import {
  applyShipmentToOrderStatus,
  canApplyShipmentStatus,
  mapCourierRawStatus,
} from "@/integrations/sandbox/status-mapping";
import {
  applyShipmentStatus,
  findShipmentByTracking,
  findShipmentEventByIdempotencyKey,
} from "@/integrations/sandbox/db-store";
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
  const result = await processWebhook({
    channel: "courier",
    provider,
    rawBody,
    signature: req.headers.get(WEBHOOK_HEADERS.signature),
    timestamp: req.headers.get(WEBHOOK_HEADERS.timestamp) ?? undefined,
    idempotencyKey,
    secret,
    apply: async () => {
      // DB backstop: a ShipmentEvent already carrying this key means the
      // webhook was applied by an earlier process/run — never apply twice.
      const priorEvent = await findShipmentEventByIdempotencyKey(idempotencyKey);
      if (priorEvent) return { applied: false, reason: "duplicate_idempotency_key" };
      const shipment = await findShipmentByTracking(parsed.data.trackingId, provider);
      if (!shipment) return { applied: false, reason: "shipment_not_found" };
      const mapped = mapCourierRawStatus(provider, parsed.data.rawStatus);
      if (mapped === null) return { applied: false, reason: "unknown_raw_status" };
      if (!canApplyShipmentStatus(shipment.status, mapped)) {
        return { applied: false, reason: `invalid_shipment_transition:${shipment.status}->${mapped}` };
      }
      try {
        await applyShipmentStatus(shipment.shipmentId, mapped, {
          eventIdempotencyKey: idempotencyKey,
          providerRawStatus: parsed.data.rawStatus,
        });
      } catch (err) {
        if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
          return { applied: false, reason: "duplicate_idempotency_key" };
        }
        throw err;
      }
      // The order-side move is evaluated against the linked order's real
      // current status and reported in the reason, exactly as before —
      // but the transition itself is applied by the orders module, not
      // here (this route never writes Order rows).
      const orderMove = applyShipmentToOrderStatus(shipment.orderStatus, mapped);
      return { applied: true, reason: orderMove.applied ? null : orderMove.reason };
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
