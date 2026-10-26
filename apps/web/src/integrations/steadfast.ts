/**
 * Steadfast Courier LIVE adapter — ADV-5 part 1 (doc 22).
 *
 * Implements the CourierProvider interface (src/integrations/courier.ts)
 * against the real Steadfast API v1:
 *
 *   Base:     https://portal.steadfast.com.bd/api/v1
 *   Auth:     `Api-Key` + `Secret-Key` headers (merchant panel API keys),
 *             supplied from encrypted Settings — see steadfast-resolver.ts
 *             (Settings keys courier.steadfast.api_key / .secret_key).
 *   Create:   POST /create_order  JSON { invoice, recipient_name,
 *             recipient_phone, recipient_address, cod_amount, note,
 *             total_lot, delivery_type } -> { status: 200, message,
 *             consignment: { consignment_id, tracking_code, status,
 *             delivery_charge, cod_fee, ... } }
 *   Status:   GET /status_by_trackingcode/{code} and
 *             GET /status_by_cid/{consignment_id} ->
 *             { status: 200, delivery_status }
 *   Balance:  GET /get_balance -> { status: 200, current_balance }
 *
 * delivery_status vocabulary (Steadfast docs) — mapped in
 * STEADFAST_DELIVERY_STATUS_MAP below, the ONE map the adapter, the
 * status poller and the live webhook branch all share:
 *   pending, in_review, hold, unknown, unknown_approval_pending,
 *   delivered_approval_pending, partial_delivered_approval_pending,
 *   delivered, partial_delivered, cancelled.
 * (The sandbox status-mapping.ts table covers the same words minus
 * `unknown`; it stays untouched for the sandbox branch.)
 *
 * HONESTY RULES (platform-wide, do not weaken):
 *  - A create the provider did not clearly accept THROWS
 *    SteadfastProviderError. Callers treat a resolved promise as a real
 *    booking, so returning a fabricated shipment would be a phantom
 *    booking — the throw is what gives BullMQ retry / dead-letter.
 *  - CANCEL: Steadfast API v1 has NO cancel endpoint. cancelShipment
 *    throws NOT_SUPPORTED (cancel from the Steadfast merchant panel).
 *    It never marks anything cancelled locally.
 *  - successRate: API v1 exposes no per-phone delivery history, so the
 *    adapter returns zero counts + successRatePercent null ("no data")
 *    — never the sandbox's hash-simulated numbers.
 *  - getRates: API v1 has no rate endpoint. Rates are the platform's
 *    own rate-card estimate (courierChargePoisha, the same function the
 *    sandbox uses); the ACTUAL charge is read from the create_order
 *    response (delivery_charge) and persisted on the Shipment row.
 *  - Money: Steadfast amounts are BDT decimals; they are converted to
 *    integer poisha exactly once, at this boundary.
 *  - Credentials are constructor inputs only — never logged, never in
 *    an error message, never in a URL this module builds.
 *
 * Persistence: bookings persist through the shared shipment store
 * (src/integrations/sandbox/db-store.ts — the DB layer every courier
 * booking uses since the 2026-10-24 DB swap; the "sandbox" in its path
 * is historical). The store is injected for smoke-testability and the
 * default store loads LAZILY (dynamic import) so this module never
 * pulls Prisma in at import time — the worker-deps landmine rule.
 * Shipment row id = `SF-<consignment_id>`; trackingId = the Steadfast
 * tracking_code. The row starts CREATED (the store's convention);
 * the consignment's own initial status is not mirrored into the row —
 * status moves arrive via getStatus polling / webhooks, as with the
 * sandbox providers.
 */
import { z } from "zod";
import { normalizeBdPhone } from "../checkout/validation";
import type {
  CourierProvider,
  CourierRate,
  CourierRateInput,
  CourierSuccessRate,
  CreateShipmentInput,
  CreateShipmentResult,
  ShipmentAddress,
  ShipmentStatus,
} from "./courier";
import { courierChargePoisha } from "./sandbox/courier-rates";
import type { ProviderConfig, WebhookVerification } from "./types";

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class SteadfastProviderError extends Error {
  readonly provider = "steadfast" as const;
  /** Machine code: NOT_CONFIGURED | NOT_SUPPORTED | INVALID_INPUT |
   *  INVALID_PHONE | NETWORK | HTTP_<status> | STEADFAST_<status> |
   *  UNRECOGNIZED_RESPONSE. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SteadfastProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Status mapping — the single source for the live adapter + webhook   */
/* ------------------------------------------------------------------ */

export const STEADFAST_DELIVERY_STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  in_review: "IN_TRANSIT",
  hold: "IN_TRANSIT",
  unknown: "IN_TRANSIT",
  unknown_approval_pending: "IN_TRANSIT",
  delivered_approval_pending: "OUT_FOR_DELIVERY",
  partial_delivered_approval_pending: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  // ShipmentStatus has no CANCELLED value; a provider-side cancel is a
  // terminal failure of the shipment (same convention as the sandbox).
  cancelled: "FAILED",
};

/** Map a raw Steadfast delivery_status to the internal ShipmentStatus.
 *  Unknown raw values return null (rejected, never coerced). */
export function mapSteadfastDeliveryStatus(rawStatus: string): ShipmentStatus | null {
  return STEADFAST_DELIVERY_STATUS_MAP[rawStatus.trim().toLowerCase()] ?? null;
}

/* ------------------------------------------------------------------ */
/* Money — BDT decimal <-> integer poisha, converted exactly once      */
/* ------------------------------------------------------------------ */

/** BDT decimal (number or numeric string, as Steadfast returns) ->
 *  integer poisha. Throws on a non-numeric value: a charge we cannot
 *  read is never persisted as a guessed number. */
export function steadfastBdtToPoisha(value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new SteadfastProviderError(
      "UNRECOGNIZED_RESPONSE",
      "Steadfast returned a non-numeric BDT amount.",
    );
  }
  return Math.round(num * 100);
}

/** Integer poisha -> the BDT decimal number Steadfast expects
 *  (cod_amount). Rounded to 2dp so no float dust reaches the wire. */
export function poishaToSteadfastBdt(poisha: number): number {
  return Number((poisha / 100).toFixed(2));
}

/* ------------------------------------------------------------------ */
/* Pure request shaping (exported for smoke tests)                     */
/* ------------------------------------------------------------------ */

function stableHash36(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

/** Steadfast `invoice` is the merchant-unique reference: a retry with
 *  the same invoice is rejected/merged by Steadfast instead of booking
 *  a second parcel. Deriving it deterministically from
 *  (orderRef, idempotencyKey) means a BullMQ retry of the same booking
 *  job reuses the same invoice — and our own store replay check below
 *  returns the original booking before any network call. */
export function buildSteadfastInvoice(orderRef: string, idempotencyKey: string): string {
  const base = orderRef.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "ORDER";
  return `${base}-${stableHash36(`${orderRef}:${idempotencyKey}`)}`;
}

/** Steadfast takes ONE free-text recipient address; compose it from the
 *  structured BD address (line first, then union/upazila/district/
 *  division), skipping empty parts. */
export function composeSteadfastAddress(address: ShipmentAddress): string {
  return [address.addressLine, address.union, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** Normalised BD mobile in Steadfast's local form (01XXXXXXXXX).
 *  Throws INVALID_PHONE before any network call on a bad number. */
export function steadfastRecipientPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new SteadfastProviderError("INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return `0${normalized.slice(4)}`; // "+880" + 10 digits -> "0" + 10 digits
}

export interface SteadfastCreateOrderBody {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  /** BDT decimal (the provider's unit — converted from poisha once). */
  cod_amount: number;
  note: string | null;
  total_lot: number;
  /** 0 = home delivery (the only flow this platform books). */
  delivery_type: 0;
}

export function buildSteadfastCreateOrderBody(
  input: CreateShipmentInput,
  invoice: string,
): SteadfastCreateOrderBody {
  return {
    invoice,
    recipient_name: input.address.recipientName,
    recipient_phone: steadfastRecipientPhone(input.address.recipientPhone),
    recipient_address: composeSteadfastAddress(input.address),
    cod_amount: poishaToSteadfastBdt(input.codAmountPoisha),
    note: input.note,
    total_lot: input.itemCount,
    delivery_type: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Webhook payload normaliser (pure; the route owns verification)      */
/* ------------------------------------------------------------------ */

export interface SteadfastWebhookEvent {
  trackingId: string;
  rawStatus: string;
  consignmentId: string | null;
  invoice: string | null;
  /** COD the payload reports (poisha). Read from the provider's
   *  cod_amount (BDT decimal) or a sandbox-style poisha field; the
   *  order-sync funnel only applies it on a DELIVERED event. */
  codCollectedPoisha: number | null;
  /** Deterministic per (consignment, status, updated_at) so a Steadfast
   *  retry of the same event dedupes against the ShipmentEvent UNIQUE
   *  key and the webhook result cache. */
  idempotencyKey: string;
}

/** Parse a Steadfast webhook body ({ consignment_id, invoice,
 *  tracking_code, status, cod_amount?, updated_at? }) — sandbox field
 *  spellings (trackingId / rawStatus / delivery_status) are accepted
 *  too. Returns null when the event cannot be identified (no tracking
 *  code or no status): the route rejects it, nothing is applied. */
export function parseSteadfastWebhookBody(body: unknown): SteadfastWebhookEvent | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const str = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") return value.trim();
      if (typeof value === "number" && Number.isFinite(value)) return String(value);
    }
    return null;
  };
  const trackingId = str("tracking_code", "trackingId", "tracking_id");
  const rawStatus = str("status", "delivery_status", "rawStatus");
  if (trackingId === null || rawStatus === null) return null;
  const consignmentId = str("consignment_id", "consignmentId");
  const updatedAt = str("updated_at", "updatedAt");
  let codCollectedPoisha: number | null = null;
  const poishaField = record.codCollectedPoisha ?? record.codAmountPoisha;
  if (typeof poishaField === "number" && Number.isInteger(poishaField) && poishaField >= 0) {
    codCollectedPoisha = poishaField;
  } else if (record.cod_amount !== undefined && record.cod_amount !== null) {
    try {
      codCollectedPoisha = steadfastBdtToPoisha(record.cod_amount);
    } catch {
      codCollectedPoisha = null;
    }
  }
  return {
    trackingId,
    rawStatus,
    consignmentId,
    invoice: str("invoice"),
    codCollectedPoisha,
    idempotencyKey: `steadfast:${consignmentId ?? trackingId}:${rawStatus}:${updatedAt ?? "na"}`,
  };
}

/* ------------------------------------------------------------------ */
/* Shipment persistence (injected; default = the shared DB store)      */
/* ------------------------------------------------------------------ */

export interface SteadfastShipmentRecord {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
}

export interface SteadfastShipmentStore {
  /** The shipment a previous booking with this idempotency key made. */
  findByBookingKey(idempotencyKey: string): Promise<SteadfastShipmentRecord | null>;
  findById(shipmentId: string): Promise<SteadfastShipmentRecord | null>;
  findByTracking(trackingId: string): Promise<SteadfastShipmentRecord | null>;
  create(input: {
    shipmentId: string;
    trackingId: string;
    provider: string;
    orderRef: string;
    codAmountPoisha: number;
    weightGrams: number;
    chargePoisha: number;
    idempotencyKey: string;
  }): Promise<SteadfastShipmentRecord>;
}

async function defaultStore(): Promise<SteadfastShipmentStore> {
  // Lazy: the DB store imports Prisma at module top level; loading it
  // only inside a booking keeps this module import-safe everywhere
  // (routes, smokes, client-adjacent graphs) — worker-deps rule.
  const db = await import("./sandbox/db-store");
  return {
    async findByBookingKey(idempotencyKey) {
      const event = await db.findShipmentEventByIdempotencyKey(`booking:${idempotencyKey}`);
      if (event === null) return null;
      return db.findShipmentById(event.shipmentId);
    },
    findById: (shipmentId) => db.findShipmentById(shipmentId),
    findByTracking: (trackingId) => db.findShipmentByTracking(trackingId, "steadfast"),
    create: (input) => db.createShipmentRow(input),
  };
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface SteadfastCredentials {
  apiKey: string;
  secretKey: string;
}

export type SteadfastFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface SteadfastAdapterOptions {
  fetchFn?: SteadfastFetch;
  timeoutMs?: number;
  store?: SteadfastShipmentStore;
  baseUrl?: string;
}

export interface SteadfastBalance {
  /** Integer poisha (BDT balance x 100), never a float taka amount. */
  balancePoisha: number;
  currency: "BDT";
}

/** The live Steadfast provider: the CourierProvider contract plus the
 *  balance probe (Steadfast API v1 offers /get_balance). */
export interface SteadfastCourierProvider extends CourierProvider {
  getBalance(): Promise<SteadfastBalance>;
}

export const STEADFAST_API_BASE = "https://portal.steadfast.com.bd/api/v1";

/** Our Shipment row id for a Steadfast consignment. */
export function steadfastShipmentId(consignmentId: string | number): string {
  return `SF-${consignmentId}`;
}

const DEFAULT_TIMEOUT_MS = 20_000;

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

function liveConfig(): ProviderConfig {
  return {
    provider: "steadfast",
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credential lives — never the value.
    credentialRef: "settings:courier.steadfast",
    lastTestedAt: null,
    lastError: null,
  };
}

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value !== "") return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function createSteadfastProvider(
  creds: SteadfastCredentials,
  opts: SteadfastAdapterOptions = {},
): SteadfastCourierProvider {
  if (creds.apiKey.trim() === "" || creds.secretKey.trim() === "") {
    throw new SteadfastProviderError(
      "NOT_CONFIGURED",
      "Steadfast api_key and secret_key are both required.",
    );
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (opts.baseUrl ?? STEADFAST_API_BASE).replace(/\/+$/, "");
  const injectedStore = opts.store ?? null;

  async function store(): Promise<SteadfastShipmentStore> {
    return injectedStore ?? defaultStore();
  }

  async function callApi(
    path: string,
    init: RequestInit,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Api-Key": creds.apiKey,
          "Secret-Key": creds.secretKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // No URL/headers in the message: nothing here may carry a secret.
      throw new SteadfastProviderError("NETWORK", "Steadfast request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      throw new SteadfastProviderError(
        `HTTP_${res.status}`,
        `Steadfast returned HTTP ${res.status}.`,
      );
    }
    const json = asRecord(parseJsonLoose(text));
    if (json === null) {
      throw new SteadfastProviderError(
        "UNRECOGNIZED_RESPONSE",
        "Steadfast returned a non-JSON response.",
      );
    }
    // Steadfast mirrors its outcome in a body `status` field (200 = ok);
    // validation failures come back as e.g. status 422 with a message.
    const bodyStatus = typeof json.status === "number" ? json.status : null;
    if (bodyStatus !== null && bodyStatus !== 200) {
      const message = stringField(json, "message") ?? "provider rejected the request";
      throw new SteadfastProviderError(
        `STEADFAST_${bodyStatus}`,
        `Steadfast error ${bodyStatus}: ${message}`,
      );
    }
    return json;
  }

  async function queryDeliveryStatus(path: string): Promise<ShipmentStatus> {
    const json = await callApi(path, { method: "GET" });
    const raw = stringField(json, "delivery_status");
    if (raw === null) {
      throw new SteadfastProviderError(
        "UNRECOGNIZED_RESPONSE",
        "Steadfast status response had no delivery_status.",
      );
    }
    const mapped = mapSteadfastDeliveryStatus(raw);
    if (mapped === null) {
      throw new SteadfastProviderError(
        "UNRECOGNIZED_RESPONSE",
        `Steadfast returned an unknown delivery_status "${raw}".`,
      );
    }
    return mapped;
  }

  return {
    name: "steadfast",
    config: liveConfig(),

    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        throw new SteadfastProviderError("INVALID_INPUT", "Invalid shipment input.");
      }
      if (input.provider !== "steadfast") {
        throw new SteadfastProviderError(
          "INVALID_INPUT",
          `Steadfast adapter cannot book provider "${input.provider}".`,
        );
      }
      const shipments = await store();
      // Replay first (same contract as the sandbox provider): a retry
      // of an already-booked job returns the stored booking and never
      // touches the network — Steadfast would reject the duplicate
      // invoice anyway, but a clean replay is not an error.
      const existing = await shipments.findByBookingKey(parsed.data.idempotencyKey);
      if (existing !== null) {
        return {
          shipmentId: existing.shipmentId,
          trackingId: existing.trackingId,
          status: existing.status,
          labelUrl: null,
        };
      }
      const invoice = buildSteadfastInvoice(parsed.data.orderId, parsed.data.idempotencyKey);
      const body = buildSteadfastCreateOrderBody(input, invoice);
      const json = await callApi("/create_order", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const consignment = asRecord(json.consignment);
      const consignmentId = consignment !== null ? stringField(consignment, "consignment_id") : null;
      const trackingCode = consignment !== null ? stringField(consignment, "tracking_code") : null;
      if (consignment === null || consignmentId === null || trackingCode === null) {
        throw new SteadfastProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Steadfast create_order response had no consignment id / tracking code.",
        );
      }
      // The ACTUAL charge for this consignment (BDT decimal at the
      // boundary -> poisha). Missing charge = a response shape we do
      // not trust enough to persist; the booking exists provider-side
      // under `invoice`, so a retry replays safely (duplicate invoice
      // rejection surfaces instead of a second parcel).
      const chargePoisha = steadfastBdtToPoisha(consignment.delivery_charge);
      const shipmentId = steadfastShipmentId(consignmentId);
      try {
        const shipment = await shipments.create({
          shipmentId,
          trackingId: trackingCode,
          provider: "steadfast",
          orderRef: parsed.data.orderId,
          codAmountPoisha: parsed.data.codAmountPoisha,
          weightGrams: parsed.data.weightGrams,
          chargePoisha,
          idempotencyKey: parsed.data.idempotencyKey,
        });
        return {
          shipmentId,
          trackingId: shipment.trackingId,
          status: shipment.status,
          labelUrl: null,
        };
      } catch (err) {
        // UNIQUE (id / trackingId) backstop: a concurrent replay won.
        if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
          const winner =
            (await shipments.findById(shipmentId)) ?? (await shipments.findByTracking(trackingCode));
          if (winner !== null) {
            return {
              shipmentId: winner.shipmentId,
              trackingId: winner.trackingId,
              status: winner.status,
              labelUrl: null,
            };
          }
        }
        throw err;
      }
    },

    async cancelShipment(_shipmentId: string) {
      void _shipmentId;
      // Steadfast API v1 has NO cancel endpoint. Faking a local cancel
      // would leave a live parcel on the road marked cancelled here —
      // the exact failure the honesty rules exist to prevent.
      throw new SteadfastProviderError(
        "NOT_SUPPORTED",
        "Steadfast API v1 has no cancel endpoint; cancel the consignment from the Steadfast merchant panel.",
      );
    },

    async getStatus(trackingId: string) {
      // Accepts a tracking code, or our `SF-<consignment_id>` shipment
      // id for a consignment-id query.
      const cid = trackingId.startsWith("SF-") ? trackingId.slice(3) : null;
      const status =
        cid !== null && cid !== ""
          ? await queryDeliveryStatus(`/status_by_cid/${encodeURIComponent(cid)}`)
          : await queryDeliveryStatus(`/status_by_trackingcode/${encodeURIComponent(trackingId)}`);
      // Events: the status API returns only the CURRENT status, so the
      // history is our own Shipment row's (empty when the parcel was
      // booked outside this install — reported honestly, not invented).
      let events: string[] = [];
      try {
        const shipments = await store();
        const row = await shipments.findByTracking(trackingId);
        if (row !== null) events = [...row.statusHistory];
      } catch {
        events = [];
      }
      return { status, events };
    },

    async getRates(input: CourierRateInput): Promise<CourierRate[]> {
      // No rate endpoint exists in API v1 (see header): this is the
      // platform rate-card ESTIMATE; the binding charge arrives with
      // the create_order response and is what the row persists.
      return [
        {
          provider: "steadfast",
          chargePoisha: courierChargePoisha(input.zone, input.weightGrams),
          estimatedDays: 2,
        },
      ];
    },

    async handleWebhook(_verification: WebhookVerification): Promise<boolean> {
      // Routes go through the couriers webhook route (processWebhook:
      // signature + idempotency + order-sync funnel). Direct calls
      // never apply — same convention as the sandbox providers.
      void _verification;
      return false;
    },

    async successRate(phone: string): Promise<CourierSuccessRate> {
      // API v1 exposes no per-phone history (see header): zero counts
      // + null rate is the honest "no data" shape the interface allows.
      return { phone, delivered: 0, failed: 0, returned: 0, successRatePercent: null };
    },

    async getBalance(): Promise<SteadfastBalance> {
      const json = await callApi("/get_balance", { method: "GET" });
      if (!("current_balance" in json)) {
        throw new SteadfastProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Steadfast balance response had no current_balance field.",
        );
      }
      return { balancePoisha: steadfastBdtToPoisha(json.current_balance), currency: "BDT" };
    },
  };
}
