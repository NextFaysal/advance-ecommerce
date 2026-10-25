// Public courier webhook (sandbox) — Agent 9.
// POST /api/v1/public/couriers/webhook?provider=steadfast|pathao|redx
// Same contract as the payment webhook: raw body + HMAC signature verified
// first (unverified => logged, 401, never applied), idempotency key makes
// replays return duplicate:true without applying twice, and every attempt
// is logged with a reason only.
// Body: { trackingId, rawStatus, idempotencyKey?, codCollectedPoisha? }
// rawStatus is mapped per provider (sandbox/status-mapping.ts), the
// shipment status only moves forward (or to FAILED/RETURNING/RETURNED),
// and — since wave 23 (doc 17 batch O5) — the linked ORDER is moved
// too, through src/courier/order-sync (the courier -> order seam that
// walks the order state machine via applyOrderTransition; this route
// itself still writes no Order rows directly). Mapping: DELIVERED ->
// order DELIVERED (+ COD collection when the payload carries
// codCollectedPoisha / codAmountPoisha), PICKED_UP / OUT_FOR_DELIVERY
// -> order SHIPPED, RETURNED -> order RETURNED; CREATED / IN_TRANSIT /
// FAILED / RETURNING are timeline notes only (conservative: a transit
// scan never ships an order, a failure never fails one).
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
  canApplyShipmentStatus,
  mapCourierRawStatus,
} from "@/integrations/sandbox/status-mapping";
import {
  recordCourierEventNote,
  transitionOrderForCourierEvent,
  type CourierOrderTarget,
} from "@/courier/order-sync";
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
  // COD cash the courier reports collecting on a delivered event
  // (integer poisha). codAmountPoisha is accepted as an alias.
  codCollectedPoisha: z.number().int().nonnegative().optional(),
  codAmountPoisha: z.number().int().nonnegative().optional(),
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
      // Order-side sync (wave 23, doc 17 batch O5): the mapped shipment
      // status now actually moves the linked order, via the courier ->
      // order seam (which walks applyOrderTransition hop by hop and is
      // idempotent against the order's real current status). The sync
      // outcome is reported in the reason only — the response shape is
      // unchanged. Replays never reach this point: processWebhook and
      // the ShipmentEvent idempotency key above dedupe first.
      const orderTarget: CourierOrderTarget | null =
        mapped === "DELIVERED"
          ? "DELIVERED"
          : mapped === "PICKED_UP" || mapped === "OUT_FOR_DELIVERY"
            ? "SHIPPED"
            : mapped === "RETURNED"
              ? "RETURNED"
              : null;
      if (orderTarget === null) {
        await recordCourierEventNote(
          shipment.orderId,
          { provider, eventId: idempotencyKey },
          `কুরিয়ার আপডেট (${provider} event ${idempotencyKey}): শিপমেন্ট অবস্থা "${mapped}" (raw: ${parsed.data.rawStatus}) — অর্ডারের অবস্থা বদলানো হয়নি / Courier update (${provider} event ${idempotencyKey}): shipment status "${mapped}" (raw: ${parsed.data.rawStatus}) — no order status change.`,
        );
        return { applied: true, reason: "order_sync:noted" };
      }
      const sync = await transitionOrderForCourierEvent(shipment.orderId, orderTarget, {
        provider,
        eventId: idempotencyKey,
        codCollectedPoisha: parsed.data.codCollectedPoisha ?? parsed.data.codAmountPoisha,
        note: `Shipment ${mapped} (raw: ${parsed.data.rawStatus})`,
      });
      return { applied: true, reason: sync.applied ? null : `order_sync:${sync.reason ?? "not_applied"}` };
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
