// Public courier webhook — Agent 9 (sandbox); ADV-5 (live branches).
// POST /api/v1/public/couriers/webhook?provider=steadfast|pathao|redx
// Same contract as the payment webhook: raw body + HMAC signature verified
// first (unverified => logged, 401, never applied), idempotency key makes
// replays return duplicate:true without applying twice, and every attempt
// is logged with a reason only.
//
// SANDBOX branch (any of the three providers while it is NOT configured
// live): body { trackingId, rawStatus, idempotencyKey?,
// codCollectedPoisha? }; secret = Admin Settings (encrypted) if
// configured, otherwise the local env SANDBOX_WEBHOOK_TEST_SECRET.
//
// LIVE branches (provider configured live — enabled + full credential
// set in Settings): the body is the provider's own webhook shape,
// normalised by that adapter's parse<Provider>WebhookBody. The
// verification secret is the REAL configured one — Settings
// courier.<provider>.webhook_secret ONLY. The sandbox test secret is
// never accepted on a live branch: no configured webhook_secret =>
// verification fails (401, no state change). The idempotency key is
// derived deterministically by the parser when the sender provides
// none. SIGNATURE-SCHEME NOTE: the live branches enforce the platform's
// own contract — HMAC-SHA256 hex of the raw body in the
// x-webhook-signature header, keyed by the Settings webhook_secret.
// ONE provider has a documented real scheme of its own (doc-verification
// wave, 2026-10-30): Pathao's official plugin sends the secret itself
// in X-PATHAO-SIGNATURE, so the Pathao live branch additionally accepts
// that header by timing-safe equality and translates it into the
// platform HMAC locally, and answers Pathao's `webhook_integration`
// handshake event with Pathao's published integration-secret header.
// RedX's scheme remains undocumented publicly, so its receiver stays
// on the platform contract and status polling is its working path.
//
// Both branches funnel into the SAME apply: rawStatus is mapped per
// provider, the shipment status only moves forward (or to FAILED/
// RETURNING/RETURNED), and — since wave 23 (doc 17 batch O5) — the
// linked ORDER is moved too, through src/courier/order-sync (the
// courier -> order seam that walks the order state machine via
// applyOrderTransition; this route itself still writes no Order rows
// directly). Mapping: DELIVERED -> order DELIVERED (+ COD collection
// when the payload carries codCollectedPoisha / codAmountPoisha /
// cod_amount), PICKED_UP / OUT_FOR_DELIVERY -> order SHIPPED, RETURNED
// -> order RETURNED; CREATED / IN_TRANSIT / FAILED / RETURNING are
// timeline notes only (conservative: a transit scan never ships an
// order, a failure never fails one).
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
import type { ShipmentStatus } from "@/integrations/courier";
import {
  mapSteadfastDeliveryStatus,
  parseSteadfastWebhookBody,
} from "@/integrations/steadfast";
import { diagnoseSteadfastCourier } from "@/integrations/steadfast-resolver";
import { mapPathaoDeliveryStatus, parsePathaoWebhookBody } from "@/integrations/pathao";
import { diagnosePathaoCourier } from "@/integrations/pathao-resolver";
import { mapRedxDeliveryStatus, parseRedxWebhookBody } from "@/integrations/redx";
import { diagnoseRedxCourier } from "@/integrations/redx-resolver";
import { mapPaperflyDeliveryStatus, parsePaperflyWebhookBody } from "@/integrations/paperfly";
import { diagnosePaperflyCourier } from "@/integrations/paperfly-resolver";
import { mapEcourierDeliveryStatus, parseEcourierWebhookBody } from "@/integrations/ecourier";
import { diagnoseEcourierCourier } from "@/integrations/ecourier-resolver";
import { COURIER_PROVIDERS } from "@/integrations/courier";
import { getIntegrationConfigWithSecrets, getSetting } from "@/lib/settings";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Pathao's webhook protocol, per Pathao's OWN open-source WooCommerce
 *  plugin (doc-verification wave, 2026-10-30): Pathao does NOT sign
 *  bodies with HMAC — it sends the webhook secret itself in the
 *  X-PATHAO-SIGNATURE header (receivers do a plain equality check), and
 *  when the integration is first connected it fires a
 *  `webhook_integration` handshake event that the receiver must answer
 *  with this fixed response header (a constant published in Pathao's
 *  plugin source) so the panel marks the integration verified. */
const PATHAO_INTEGRATION_SECRET = "f3992ecc-59da-4cbe-a049-a13da2018d51";

function safeSecretEqual(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

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

/** The REAL live-branch webhook secret for a provider: encrypted
 *  Settings only. The sandbox env test secret is deliberately NOT a
 *  fallback here — on a live branch an unconfigured webhook secret
 *  means verification fails closed (401, nothing applied), never a
 *  silent sandbox pass. */
async function liveWebhookSecret(provider: string): Promise<string | null> {
  try {
    return await getSetting(`courier.${provider}.webhook_secret`);
  } catch {
    return null;
  }
}

/** Is this provider configured live (enabled + credentials complete)?
 *  Any settings failure reads as "not configured" — the request then
 *  takes the sandbox branch and stays labelled sandbox. */
async function liveConfigured(provider: string): Promise<boolean> {
  const reader = {
    getSetting: (key: string) => getSetting(key),
    getProviderSecrets: (name: string) => getIntegrationConfigWithSecrets("courier", name),
  };
  try {
    switch (provider) {
      case "steadfast":
        return (await diagnoseSteadfastCourier(reader)).configured;
      case "pathao":
        return (await diagnosePathaoCourier(reader)).configured;
      case "redx":
        return (await diagnoseRedxCourier(reader)).configured;
      case "paperfly":
        return (await diagnosePaperflyCourier(reader)).configured;
      case "ecourier":
        return (await diagnoseEcourierCourier(reader)).configured;
      default:
        return false;
    }
  } catch {
    return false;
  }
}

/** The minimal event shape every live parser produces. */
interface LiveWebhookEvent {
  trackingId: string;
  rawStatus: string;
  codCollectedPoisha: number | null;
  idempotencyKey: string;
}

interface LiveWebhookSpec {
  parse: (body: unknown) => LiveWebhookEvent | null;
  mapRawStatus: (rawStatus: string) => ShipmentStatus | null;
  invalidBodyMessage: string;
}

const LIVE_WEBHOOK_SPECS: Record<string, LiveWebhookSpec> = {
  steadfast: {
    parse: parseSteadfastWebhookBody,
    mapRawStatus: mapSteadfastDeliveryStatus,
    invalidBodyMessage: "Invalid Steadfast webhook body.",
  },
  pathao: {
    parse: parsePathaoWebhookBody,
    mapRawStatus: mapPathaoDeliveryStatus,
    invalidBodyMessage: "Invalid Pathao webhook body.",
  },
  redx: {
    parse: parseRedxWebhookBody,
    mapRawStatus: mapRedxDeliveryStatus,
    invalidBodyMessage: "Invalid RedX webhook body.",
  },
  paperfly: {
    parse: parsePaperflyWebhookBody,
    mapRawStatus: mapPaperflyDeliveryStatus,
    invalidBodyMessage: "Invalid Paperfly webhook body.",
  },
  ecourier: {
    parse: parseEcourierWebhookBody,
    mapRawStatus: mapEcourierDeliveryStatus,
    invalidBodyMessage: "Invalid eCourier webhook body.",
  },
};

interface CourierEventInput {
  provider: string;
  trackingId: string;
  rawStatus: string;
  idempotencyKey: string;
  codCollectedPoisha?: number;
  /** Provider-specific raw-status -> ShipmentStatus map (null = unknown). */
  mapRawStatus: (rawStatus: string) => ShipmentStatus | null;
}

/** The shared apply behind processWebhook for BOTH branches: shipment
 *  row moves through the state machine, then the linked order follows
 *  through the courier -> order sync seam. Identical semantics to the
 *  original sandbox-only route; only the mapping + event source differ
 *  per branch. */
async function applyCourierEvent(
  event: CourierEventInput,
): Promise<{ applied: boolean; reason: string | null }> {
  const { provider, idempotencyKey } = event;
  // DB backstop: a ShipmentEvent already carrying this key means the
  // webhook was applied by an earlier process/run — never apply twice.
  const priorEvent = await findShipmentEventByIdempotencyKey(idempotencyKey);
  if (priorEvent) return { applied: false, reason: "duplicate_idempotency_key" };
  const shipment = await findShipmentByTracking(event.trackingId, provider);
  if (!shipment) return { applied: false, reason: "shipment_not_found" };
  const mapped = event.mapRawStatus(event.rawStatus);
  if (mapped === null) return { applied: false, reason: "unknown_raw_status" };
  if (!canApplyShipmentStatus(shipment.status, mapped)) {
    return { applied: false, reason: `invalid_shipment_transition:${shipment.status}->${mapped}` };
  }
  try {
    await applyShipmentStatus(shipment.shipmentId, mapped, {
      eventIdempotencyKey: idempotencyKey,
      providerRawStatus: event.rawStatus,
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
      `কুরিয়ার আপডেট (${provider} event ${idempotencyKey}): শিপমেন্ট অবস্থা "${mapped}" (raw: ${event.rawStatus}) — অর্ডারের অবস্থা বদলানো হয়নি / Courier update (${provider} event ${idempotencyKey}): shipment status "${mapped}" (raw: ${event.rawStatus}) — no order status change.`,
    );
    return { applied: true, reason: "order_sync:noted" };
  }
  const sync = await transitionOrderForCourierEvent(shipment.orderId, orderTarget, {
    provider,
    eventId: idempotencyKey,
    codCollectedPoisha: event.codCollectedPoisha,
    note: `Shipment ${mapped} (raw: ${event.rawStatus})`,
  });
  return { applied: true, reason: sync.applied ? null : `order_sync:${sync.reason ?? "not_applied"}` };
}

export async function POST(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider") ?? "";
  // Gate widened (wave 51) from SANDBOX_COURIER_PROVIDERS to all known
  // providers: paperfly/ecourier have live adapters but NO sandbox
  // provider — on the sandbox branch their raw statuses simply map to
  // null (unknown_raw_status no-op) rather than a simulated booking.
  if (!(COURIER_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Unknown courier provider." } },
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

  /* ---------------- LIVE branches (ADV-5: steadfast, pathao, redx) ---------------- */
  const liveSpec = LIVE_WEBHOOK_SPECS[provider];
  if (liveSpec !== undefined && (await liveConfigured(provider))) {
    // Pathao integration handshake: no consignment/status to apply —
    // answering with Pathao's published integration-secret header is
    // the whole protocol (their panel then marks the webhook verified).
    if (
      provider === "pathao" &&
      typeof body === "object" &&
      body !== null &&
      (body as Record<string, unknown>).event === "webhook_integration"
    ) {
      return NextResponse.json(
        {
          data: { verified: true, duplicate: false, applied: false, reason: "integration_handshake" },
          meta: { sandbox: false, live: true, provider },
        },
        {
          status: 200,
          headers: { "X-Pathao-Merchant-Webhook-Integration-Secret": PATHAO_INTEGRATION_SECRET },
        },
      );
    }
    const event = liveSpec.parse(body);
    if (event === null) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: liveSpec.invalidBodyMessage } },
        { status: 400 },
      );
    }
    const bodyKey =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>).idempotencyKey
        : undefined;
    const idempotencyKey =
      req.headers.get(WEBHOOK_HEADERS.idempotencyKey) ??
      (typeof bodyKey === "string" && bodyKey !== "" ? bodyKey : null) ??
      event.idempotencyKey;
    const secret = await liveWebhookSecret(provider);
    // Pathao's real scheme: the secret itself arrives in
    // X-PATHAO-SIGNATURE. On a timing-safe match, translate it into the
    // platform HMAC locally so the shared verify/log/apply pipeline
    // below runs unchanged; anything else falls through to the plain
    // platform-HMAC check and fails closed as before.
    let signature = req.headers.get(WEBHOOK_HEADERS.signature);
    if (provider === "pathao" && secret) {
      const presented = req.headers.get("x-pathao-signature");
      if (presented && safeSecretEqual(presented, secret)) {
        signature = createHmac("sha256", secret).update(rawBody).digest("hex");
      }
    }
    const result = await processWebhook({
      channel: "courier",
      provider,
      rawBody,
      signature,
      timestamp: req.headers.get(WEBHOOK_HEADERS.timestamp) ?? undefined,
      idempotencyKey,
      secret,
      apply: () =>
        applyCourierEvent({
          provider,
          trackingId: event.trackingId,
          rawStatus: event.rawStatus,
          idempotencyKey,
          codCollectedPoisha: event.codCollectedPoisha ?? undefined,
          mapRawStatus: liveSpec.mapRawStatus,
        }),
    });
    return NextResponse.json(
      {
        data: {
          verified: result.verified,
          duplicate: result.duplicate,
          applied: result.applied,
          reason: result.reason,
        },
        meta: { sandbox: false, live: true, provider },
      },
      { status: result.httpStatus },
    );
  }

  /* ---------------- Sandbox branch (unchanged contract) ---------------- */
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
    apply: () =>
      applyCourierEvent({
        provider,
        trackingId: parsed.data.trackingId,
        rawStatus: parsed.data.rawStatus,
        idempotencyKey,
        codCollectedPoisha: parsed.data.codCollectedPoisha ?? parsed.data.codAmountPoisha,
        mapRawStatus: (raw) => mapCourierRawStatus(provider, raw),
      }),
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
