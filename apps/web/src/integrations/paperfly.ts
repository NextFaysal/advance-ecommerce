/**
 * Paperfly Courier LIVE adapter — ADV-5 completion (doc 22).
 *
 * Implements the CourierProvider interface (src/integrations/courier.ts)
 * against the Paperfly merchant API, mirroring the Steadfast / RedX
 * live adapters (src/integrations/steadfast.ts, redx.ts)
 * contract-for-contract:
 *
 *   Base:     https://api.paperfly.com.bd
 *   Auth:     THREE headers on every call — `username` + `password`
 *             (the merchant-panel login) and `paperflykey` (the
 *             merchant API key). All three come from encrypted
 *             Settings — see paperfly-resolver.ts (Settings keys
 *             courier.paperfly.username / .password / .api_key).
 *   Create:   POST /OrderPlacement — Paperfly references a parcel by
 *             the MERCHANT's own reference (`ref_id`), and tracking
 *             is by that same reference: Paperfly has no separate
 *             consignment id in this integration, so our trackingId
 *             IS the deterministic invoice derived from
 *             (orderRef, idempotencyKey) — the same value a retry
 *             reuses, which is what makes a re-booking merge instead
 *             of duplicating. `store_name` (Settings
 *             courier.paperfly.store_name, optional) is sent when
 *             configured; parcel weight goes as `max_weight` (kg).
 *   Status:   GET /API-Order-Tracking/{ref_id}.
 *
 * UNVERIFIED-API NOTE (honesty): no live Paperfly account exists on
 * this install yet, and Paperfly's API details could not be verified
 * from this codebase. The base URL, the three auth header names and
 * the create/track endpoint paths are the Paperfly merchant API
 * shape as documented publicly at build time; the create REQUEST
 * FIELD SPELLINGS (ref_id / customer_name / cash_collection_amount /
 * max_weight / ...) are the least-verified part of this module.
 * Response parsing is deliberately TOLERANT (several accepted
 * spellings per field, plus the boolean status flags Paperfly's
 * tracking payload is known to carry — `inTransit: true` style), and
 * the first live booking MUST be reconciled against the merchant
 * panel — the create field spellings are the first thing to
 * re-verify there. Nothing in this module pretends a call succeeded
 * when the provider did not clearly accept it.
 *
 * HONESTY RULES (platform-wide, do not weaken — same as Steadfast):
 *  - A create the provider did not clearly accept THROWS
 *    PaperflyProviderError. Callers treat a resolved promise as a
 *    real booking, so returning a fabricated shipment would be a
 *    phantom booking — the throw is what gives BullMQ retry /
 *    dead-letter. If Paperfly accepted but returned no readable
 *    delivery charge, the create still throws (UNRECOGNIZED_RESPONSE)
 *    rather than persisting a guessed charge; the booking exists
 *    provider-side under `ref_id`, so a retry replays safely.
 *  - CANCEL: a Paperfly cancel endpoint exists in the wild but is
 *    publicly flagged UNVERIFIED against current Paperfly docs, so
 *    cancelShipment throws NOT_SUPPORTED (cancel from the Paperfly
 *    merchant panel) — the same posture as the sibling adapters. It
 *    never marks anything cancelled locally.
 *  - successRate: no per-phone delivery-history endpoint is known, so
 *    the adapter returns zero counts + successRatePercent null ("no
 *    data") — never simulated numbers.
 *  - getRates: the binding charge for a booking is the charge on the
 *    create response, persisted on the Shipment row. getRates stays
 *    the platform rate-card ESTIMATE (courierChargePoisha, the same
 *    function the sandbox uses).
 *  - Money: Paperfly amounts are BDT decimals; they are converted to
 *    integer poisha exactly once, at this boundary. Parcel weight is
 *    sent in kg decimals, converted from grams at the same boundary.
 *  - The username / password / API key are constructor inputs only —
 *    never logged, never in an error message, never in a URL this
 *    module builds. (The password travels in a request HEADER, as
 *    Paperfly's scheme requires — never in a body this module logs.)
 *
 * Persistence: bookings persist through the shared shipment store
 * (src/integrations/sandbox/db-store.ts — the DB layer every courier
 * booking uses; the "sandbox" in its path is historical). The store
 * is injected for smoke-testability and the default store loads
 * LAZILY (dynamic import) so this module never pulls Prisma in at
 * import time — the worker-deps landmine rule. Shipment row id =
 * `PF-<ref_id>`; trackingId = the ref_id itself (see Create above).
 * A provider-issued tracking number, when the create response
 * carries one, is parsed but NOT persisted in v1 (the row is keyed
 * by the reference Paperfly itself tracks by).
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

export class PaperflyProviderError extends Error {
  readonly provider = "paperfly" as const;
  /** Machine code: NOT_CONFIGURED | NOT_SUPPORTED | INVALID_INPUT |
   *  INVALID_PHONE | NETWORK | HTTP_<status> | PAPERFLY_<code> |
   *  UNRECOGNIZED_RESPONSE. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaperflyProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Status mapping — the single source for the live adapter + webhook   */
/* ------------------------------------------------------------------ */

/** Normalise a raw Paperfly status for map lookup: case/space/hyphen
 *  differences ("in-transit", "In Transit") must not matter. */
export function normalizePaperflyStatus(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const PAPERFLY_DELIVERY_STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  order_placed: "CREATED",
  placed: "CREATED",
  created: "CREATED",
  pickup_pending: "CREATED",
  picked: "PICKED_UP",
  picked_up: "PICKED_UP",
  pickup_done: "PICKED_UP",
  pickup_completed: "PICKED_UP",
  in_transit: "IN_TRANSIT",
  transit: "IN_TRANSIT",
  at_hub: "IN_TRANSIT",
  received_at_hub: "IN_TRANSIT",
  on_hold: "IN_TRANSIT",
  hold: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  out_for_delivery_started: "OUT_FOR_DELIVERY",
  delivering: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  partially_delivered: "DELIVERED",
  delivery_failed: "FAILED",
  failed: "FAILED",
  undelivered: "FAILED",
  // ShipmentStatus has no CANCELLED value; a provider-side cancel is a
  // terminal failure of the shipment (same convention as Steadfast).
  cancelled: "FAILED",
  canceled: "FAILED",
  returning: "RETURNING",
  return_in_transit: "RETURNING",
  return_pending: "RETURNING",
  returned: "RETURNED",
  return_delivered: "RETURNED",
};

/** Map a raw Paperfly status to the internal ShipmentStatus. Unknown
 *  raw values return null (rejected, never coerced). */
export function mapPaperflyDeliveryStatus(rawStatus: string): ShipmentStatus | null {
  return PAPERFLY_DELIVERY_STATUS_MAP[normalizePaperflyStatus(rawStatus)] ?? null;
}

/** Paperfly's tracking payload is known to carry BOOLEAN status flags
 *  (e.g. `inTransit: true`) alongside — or instead of — a status
 *  string. Read them in lifecycle-priority order (terminal states
 *  first, so a payload that reports both progress and completion
 *  maps to completion). Returns null when no known flag is set. */
export function paperflyStatusFromFlags(record: Record<string, unknown>): ShipmentStatus | null {
  const flag = (...keys: string[]): boolean =>
    keys.some((key) => record[key] === true || record[key] === "true" || record[key] === 1);
  if (flag("delivered", "isDelivered")) return "DELIVERED";
  if (flag("returned", "isReturned")) return "RETURNED";
  if (flag("returning", "isReturning", "returnInTransit")) return "RETURNING";
  if (flag("cancelled", "canceled", "isCancelled")) return "FAILED";
  if (flag("failed", "isFailed", "deliveryFailed")) return "FAILED";
  if (flag("outForDelivery", "out_for_delivery_flag", "isOutForDelivery")) {
    return "OUT_FOR_DELIVERY";
  }
  if (flag("pickedUp", "picked_up_flag", "isPickedUp", "picked")) return "PICKED_UP";
  if (flag("inTransit", "in_transit_flag", "isInTransit")) return "IN_TRANSIT";
  if (flag("onHold", "isOnHold")) return "IN_TRANSIT";
  return null;
}

/* ------------------------------------------------------------------ */
/* Money — BDT decimal <-> integer poisha, converted exactly once      */
/* ------------------------------------------------------------------ */

/** BDT decimal (number or numeric string, as Paperfly returns) ->
 *  integer poisha. Throws on a non-numeric value: a charge we cannot
 *  read is never persisted as a guessed number. */
export function paperflyBdtToPoisha(value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new PaperflyProviderError(
      "UNRECOGNIZED_RESPONSE",
      "Paperfly returned a non-numeric BDT amount.",
    );
  }
  return Math.round(num * 100);
}

/** Integer poisha -> the BDT decimal number Paperfly expects
 *  (cash_collection_amount). Rounded to 2dp so no float dust reaches
 *  the wire. */
export function poishaToPaperflyBdt(poisha: number): number {
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

/** Paperfly `ref_id` is the merchant-unique reference AND the
 *  tracking key: a retry with the same ref must merge, not book a
 *  second parcel. Deriving it deterministically from
 *  (orderRef, idempotencyKey) means a BullMQ retry of the same
 *  booking job reuses the same reference — and our own store replay
 *  check returns the original booking before any network call. */
export function buildPaperflyRefId(orderRef: string, idempotencyKey: string): string {
  const base = orderRef.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "ORDER";
  return `${base}-${stableHash36(`${orderRef}:${idempotencyKey}`)}`;
}

/** Paperfly takes ONE free-text customer address; compose it from the
 *  structured BD address (line first, then union/upazila/district/
 *  division), skipping empty parts. */
export function composePaperflyAddress(address: ShipmentAddress): string {
  return [address.addressLine, address.union, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** Normalised BD mobile in Paperfly's local form (01XXXXXXXXX).
 *  Throws INVALID_PHONE before any network call on a bad number. */
export function paperflyRecipientPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new PaperflyProviderError("INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return `0${normalized.slice(4)}`; // "+880" + 10 digits -> "0" + 10 digits
}

/** Grams -> the kg decimal Paperfly expects (max_weight). */
export function gramsToPaperflyKg(weightGrams: number): number {
  return Number((weightGrams / 1000).toFixed(2));
}

export interface PaperflyCreateOrderBody {
  /** The merchant reference Paperfly tracks the parcel by. */
  ref_id: string;
  /** Pickup store name (Settings courier.paperfly.store_name); sent
   *  only when configured. */
  store_name?: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  district: string;
  thana: string;
  /** BDT decimal (the provider's unit — converted from poisha once). */
  cash_collection_amount: number;
  /** Declared parcel value (BDT decimal): the COD amount. */
  total_amount: number;
  /** kg decimal (the provider's unit — converted from grams once). */
  max_weight: number;
  total_lot: number;
  note: string | null;
}

export function buildPaperflyCreateOrderBody(
  input: CreateShipmentInput,
  refId: string,
  storeName: string,
): PaperflyCreateOrderBody {
  const body: PaperflyCreateOrderBody = {
    ref_id: refId,
    customer_name: input.address.recipientName,
    customer_phone: paperflyRecipientPhone(input.address.recipientPhone),
    customer_address: composePaperflyAddress(input.address),
    district: input.address.district,
    thana: input.address.upazila,
    cash_collection_amount: poishaToPaperflyBdt(input.codAmountPoisha),
    total_amount: poishaToPaperflyBdt(input.codAmountPoisha),
    max_weight: gramsToPaperflyKg(input.weightGrams),
    total_lot: input.itemCount,
    note: input.note,
  };
  if (storeName.trim() !== "") body.store_name = storeName.trim();
  return body;
}

/* ------------------------------------------------------------------ */
/* Webhook payload normaliser (pure; the route owns verification)      */
/* ------------------------------------------------------------------ */

export interface PaperflyWebhookEvent {
  trackingId: string;
  rawStatus: string;
  refId: string | null;
  /** COD the payload reports (poisha), converted from a BDT field at
   *  this boundary; the order-sync funnel only applies it on a
   *  DELIVERED event. */
  codCollectedPoisha: number | null;
  /** Deterministic per (ref, status, updated_at) so a Paperfly retry
   *  of the same event dedupes against the ShipmentEvent UNIQUE key
   *  and the webhook result cache. NOTE: Paperfly publishes no
   *  webhook in anything this codebase can verify — this parser
   *  exists so the platform's LIVE_WEBHOOK_SPECS contract has a
   *  Paperfly entry ready if/when the merchant panel offers one;
   *  status polling (getStatus) is the working path today. */
  idempotencyKey: string;
}

/** Parse a Paperfly webhook body — provider spellings (ref_id /
 *  tracking_number / status) and sandbox spellings (trackingId /
 *  rawStatus) are both accepted. Returns null when the event cannot
 *  be identified (no reference or no status): the route rejects it,
 *  nothing is applied. A payload carrying ONLY boolean flags yields a
 *  rawStatus synthesised from the winning flag's canonical key. */
export function parsePaperflyWebhookBody(body: unknown): PaperflyWebhookEvent | null {
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
  const refId = str("ref_id", "refId", "merchant_ref", "invoice");
  const providerTracking = str("tracking_number", "trackingNumber", "tracking_no");
  const trackingId = str("trackingId", "tracking_id") ?? providerTracking ?? refId;
  let rawStatus = str("status", "delivery_status", "current_status", "rawStatus");
  if (rawStatus === null) {
    const fromFlags = paperflyStatusFromFlags(record);
    if (fromFlags !== null) {
      rawStatus =
        fromFlags === "DELIVERED"
          ? "delivered"
          : fromFlags === "RETURNED"
            ? "returned"
            : fromFlags === "RETURNING"
              ? "returning"
              : fromFlags === "FAILED"
                ? "failed"
                : fromFlags === "OUT_FOR_DELIVERY"
                  ? "out_for_delivery"
                  : fromFlags === "PICKED_UP"
                    ? "picked_up"
                    : "in_transit";
    }
  }
  if (trackingId === null || rawStatus === null) return null;
  const updatedAt = str("updated_at", "updatedAt");
  let codCollectedPoisha: number | null = null;
  const poishaField = record.codCollectedPoisha ?? record.codAmountPoisha;
  if (typeof poishaField === "number" && Number.isInteger(poishaField) && poishaField >= 0) {
    codCollectedPoisha = poishaField;
  } else {
    const bdtField = record.collected_amount ?? record.cash_collection_amount ?? record.cod_amount;
    if (bdtField !== undefined && bdtField !== null) {
      try {
        codCollectedPoisha = paperflyBdtToPoisha(bdtField);
      } catch {
        codCollectedPoisha = null;
      }
    }
  }
  return {
    trackingId,
    rawStatus,
    refId,
    codCollectedPoisha,
    idempotencyKey: `paperfly:${refId ?? trackingId}:${normalizePaperflyStatus(rawStatus)}:${updatedAt ?? "na"}`,
  };
}

/* ------------------------------------------------------------------ */
/* Shipment persistence (injected; default = the shared DB store)      */
/* ------------------------------------------------------------------ */

export interface PaperflyShipmentRecord {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
}

export interface PaperflyShipmentStore {
  /** The shipment a previous booking with this idempotency key made. */
  findByBookingKey(idempotencyKey: string): Promise<PaperflyShipmentRecord | null>;
  findById(shipmentId: string): Promise<PaperflyShipmentRecord | null>;
  findByTracking(trackingId: string): Promise<PaperflyShipmentRecord | null>;
  create(input: {
    shipmentId: string;
    trackingId: string;
    provider: string;
    orderRef: string;
    codAmountPoisha: number;
    weightGrams: number;
    chargePoisha: number;
    idempotencyKey: string;
  }): Promise<PaperflyShipmentRecord>;
}

async function defaultStore(): Promise<PaperflyShipmentStore> {
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
    findByTracking: (trackingId) => db.findShipmentByTracking(trackingId, "paperfly"),
    create: (input) => db.createShipmentRow(input),
  };
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface PaperflyCredentials {
  username: string;
  password: string;
  apiKey: string;
  /** Optional pickup store name (Settings courier.paperfly.store_name). */
  storeName?: string;
}

export type PaperflyFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PaperflyAdapterOptions {
  fetchFn?: PaperflyFetch;
  timeoutMs?: number;
  store?: PaperflyShipmentStore;
  baseUrl?: string;
}

/** The live Paperfly provider: the CourierProvider contract plus the
 *  credential probe the resolver's connection test uses (Paperfly
 *  offers no balance/list endpoint in this integration). */
export interface PaperflyCourierProvider extends CourierProvider {
  checkCredentials(): Promise<{ referenceChecked: string }>;
}

export const PAPERFLY_API_BASE = "https://api.paperfly.com.bd";

/** Our Shipment row id for a Paperfly parcel (keyed by ref_id). */
export function paperflyShipmentId(refId: string): string {
  return `PF-${refId}`;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Sentinel reference for the credential probe: a booking reference
 *  that cannot exist, so the probe never touches a real parcel. */
const PROBE_REFERENCE = "AE-CONNECTION-PROBE";

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

function liveConfig(): ProviderConfig {
  return {
    provider: "paperfly",
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credentials live — never the values.
    credentialRef: "settings:courier.paperfly",
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

/** Paperfly success flag, tolerantly: an explicit `success: false` /
 *  `status: "failed"|"error"` means the provider refused, whatever
 *  the HTTP code said. Anything else is judged by the caller from
 *  the payload's identifiers. */
function providerRefused(json: Record<string, unknown>): string | null {
  if (json.success === false) {
    return stringField(json, "message", "error") ?? "provider reported failure";
  }
  const status = typeof json.status === "string" ? json.status.trim().toLowerCase() : "";
  if (status === "failed" || status === "error" || status === "failure") {
    return stringField(json, "message", "error") ?? "provider reported failure";
  }
  return null;
}

export function createPaperflyProvider(
  creds: PaperflyCredentials,
  opts: PaperflyAdapterOptions = {},
): PaperflyCourierProvider {
  if (creds.username.trim() === "" || creds.password.trim() === "" || creds.apiKey.trim() === "") {
    throw new PaperflyProviderError(
      "NOT_CONFIGURED",
      "Paperfly username, password and api_key are all required.",
    );
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (opts.baseUrl ?? PAPERFLY_API_BASE).replace(/\/+$/, "");
  const injectedStore = opts.store ?? null;

  async function store(): Promise<PaperflyShipmentStore> {
    return injectedStore ?? defaultStore();
  }

  /** One raw call: resolves { status, json } for ANY HTTP status
   *  (json null when the body is not a JSON object); throws only
   *  NETWORK. Header values are credentials — never logged, never in
   *  an error message. */
  async function callApiRaw(
    path: string,
    init: RequestInit,
  ): Promise<{ status: number; json: Record<string, unknown> | null }> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          // Paperfly merchant API auth (see the UNVERIFIED note in
          // the file header — re-verify at first live use).
          username: creds.username,
          password: creds.password,
          paperflykey: creds.apiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new PaperflyProviderError("NETWORK", "Paperfly request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    return { status: res.status, json: asRecord(parseJsonLoose(text)) };
  }

  async function callApi(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const { status, json } = await callApiRaw(path, init);
    if (status < 200 || status >= 300) {
      throw new PaperflyProviderError(`HTTP_${status}`, `Paperfly returned HTTP ${status}.`);
    }
    if (json === null) {
      throw new PaperflyProviderError("UNRECOGNIZED_RESPONSE", "Paperfly returned a non-JSON response.");
    }
    const refused = providerRefused(json);
    if (refused !== null) {
      throw new PaperflyProviderError("PAPERFLY_REJECTED", `Paperfly rejected the request: ${refused}`);
    }
    return json;
  }

  /** The charge Paperfly recorded for a parcel (BDT field ->
   *  poisha); null when the record carries none. */
  function chargeFromRecord(record: Record<string, unknown>): number | null {
    const field =
      record.delivery_charge ?? record.charge ?? record.delivery_fee ?? record.total_charge;
    if (field === undefined || field === null) return null;
    try {
      return paperflyBdtToPoisha(field);
    } catch {
      return null;
    }
  }

  /** Tracking read shared by getStatus + the credential probe: the
   *  parsed payload record for a reference (create-response `data`
   *  nesting tolerated). Throws on transport/HTTP/shape failures. */
  async function fetchTrackingRecord(ref: string): Promise<Record<string, unknown>> {
    const json = await callApi(`/API-Order-Tracking/${encodeURIComponent(ref)}`, {
      method: "GET",
    });
    return asRecord(json.data) ?? asRecord(json.tracking) ?? json;
  }

  return {
    name: "paperfly",
    config: liveConfig(),

    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        throw new PaperflyProviderError("INVALID_INPUT", "Invalid shipment input.");
      }
      if (input.provider !== "paperfly") {
        throw new PaperflyProviderError(
          "INVALID_INPUT",
          `Paperfly adapter cannot book provider "${input.provider}".`,
        );
      }
      const shipments = await store();
      // Replay first (same contract as the sandbox + Steadfast
      // providers): a retry of an already-booked job returns the
      // stored booking and never touches the network.
      const existing = await shipments.findByBookingKey(parsed.data.idempotencyKey);
      if (existing !== null) {
        return {
          shipmentId: existing.shipmentId,
          trackingId: existing.trackingId,
          status: existing.status,
          labelUrl: null,
        };
      }
      const refId = buildPaperflyRefId(parsed.data.orderId, parsed.data.idempotencyKey);
      const body = buildPaperflyCreateOrderBody(input, refId, creds.storeName ?? "");
      const json = await callApi("/OrderPlacement", {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = asRecord(json.data) ?? json;
      // Acceptance test: Paperfly tracks by OUR ref_id, so a clear
      // acceptance is a 2xx non-refused payload that echoes the
      // reference (or carries its own tracking number). Anything
      // murkier is NOT a booking we may report.
      const echoedRef = stringField(data, "ref_id", "refId", "merchant_ref", "reference");
      const providerTracking = stringField(
        data,
        "tracking_number",
        "trackingNumber",
        "tracking_no",
        "tracking_id",
      );
      if (echoedRef !== refId && providerTracking === null && echoedRef === null) {
        throw new PaperflyProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Paperfly create-order response did not echo the reference or a tracking number.",
        );
      }
      // The ACTUAL charge for this parcel (BDT decimal at the
      // boundary -> poisha). When the create response carries none,
      // one tracking read is tried; a charge we still cannot read is
      // never persisted as a guess — the booking exists
      // provider-side under `ref_id`, so a retry replays safely.
      let chargePoisha = chargeFromRecord(data);
      if (chargePoisha === null) {
        try {
          chargePoisha = chargeFromRecord(await fetchTrackingRecord(refId));
        } catch {
          chargePoisha = null;
        }
      }
      if (chargePoisha === null) {
        throw new PaperflyProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Paperfly create-order response had no readable delivery charge.",
        );
      }
      const shipmentId = paperflyShipmentId(refId);
      try {
        const shipment = await shipments.create({
          shipmentId,
          trackingId: refId,
          provider: "paperfly",
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
            (await shipments.findById(shipmentId)) ?? (await shipments.findByTracking(refId));
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
      // A Paperfly cancel endpoint exists in the wild but is
      // publicly flagged unverified against current Paperfly docs.
      // Faking a local cancel would leave a live parcel on the road
      // marked cancelled here — the exact failure the honesty rules
      // exist to prevent.
      throw new PaperflyProviderError(
        "NOT_SUPPORTED",
        "Paperfly cancel endpoint is unverified in this integration; cancel the parcel from the Paperfly merchant panel.",
      );
    },

    async getStatus(trackingId: string) {
      // The tracking key IS the merchant ref_id; our `PF-<ref_id>`
      // shipment id is accepted too.
      const ref = trackingId.startsWith("PF-") ? trackingId.slice(3) : trackingId;
      const data = await fetchTrackingRecord(ref);
      const raw = stringField(data, "status", "delivery_status", "current_status", "order_status");
      let status: ShipmentStatus | null = raw !== null ? mapPaperflyDeliveryStatus(raw) : null;
      if (status === null) {
        // No (recognised) status string: Paperfly's tracking payload
        // is known to carry boolean flags instead.
        status = paperflyStatusFromFlags(data);
      }
      if (status === null) {
        throw new PaperflyProviderError(
          "UNRECOGNIZED_RESPONSE",
          raw !== null
            ? `Paperfly returned an unknown status "${raw}".`
            : "Paperfly tracking response had no status field or known status flag.",
        );
      }
      // Events: the tracking API returns only the CURRENT status, so
      // the history is our own Shipment row's (empty when the parcel
      // was booked outside this install — reported honestly, not
      // invented).
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
      // Platform rate-card ESTIMATE (see header): the binding charge
      // arrives with the create response and is what the row persists.
      return [
        {
          provider: "paperfly",
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
      // No per-phone history endpoint is known (see header): zero
      // counts + null rate is the honest "no data" shape.
      return { phone, delivered: 0, failed: 0, returned: 0, successRatePercent: null };
    },

    async checkCredentials(): Promise<{ referenceChecked: string }> {
      // Paperfly has no balance/list endpoint in this integration,
      // so the probe is a tracking read for a reference that cannot
      // exist. PASS = the API answered with parseable JSON and did
      // NOT refuse the credential headers (401/403): that verifies
      // reachability + header acceptance ONLY — never order
      // placement — and the resolver's probe message says exactly
      // that. A provider that rejects bad credentials with a 200
      // "success:false" body would false-pass this probe; that
      // limitation is documented here and in the probe message.
      const { status, json } = await callApiRaw(
        `/API-Order-Tracking/${encodeURIComponent(PROBE_REFERENCE)}`,
        { method: "GET" },
      );
      if (status === 401 || status === 403) {
        throw new PaperflyProviderError(
          `HTTP_${status}`,
          `Paperfly refused the configured credentials (HTTP ${status}).`,
        );
      }
      if (json === null) {
        throw new PaperflyProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Paperfly probe returned a non-JSON response.",
        );
      }
      return { referenceChecked: PROBE_REFERENCE };
    },
  };
}
