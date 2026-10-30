/**
 * RedX Courier LIVE adapter — ADV-5 remainder (doc 22).
 *
 * Implements the CourierProvider interface (src/integrations/courier.ts)
 * against the RedX merchant API, mirroring the Steadfast live adapter
 * (src/integrations/steadfast.ts) contract-for-contract:
 *
 *   Base:     https://openapi.redx.com.bd/v1.0.0-beta (the default;
 *             overridable per install via the courier.redx.base_url
 *             Setting — see redx-resolver.ts).
 *   Auth:     a merchant access token, sent on every call in the
 *             `API-ACCESS-TOKEN` header. The token comes from encrypted
 *             Settings — see redx-resolver.ts (Settings key
 *             courier.redx.access_token, encrypted at rest by the
 *             settings service's secret-suffix rule).
 *   Areas:    GET /areas -> the delivery areas RedX serves; a booking
 *             needs a numeric delivery_area_id, so create resolves the
 *             structured BD address against this list (district first,
 *             then upazila; cached per instance). No match -> the
 *             booking aborts with INVALID_INPUT; an id is never
 *             guessed.
 *   Create:   POST /parcel { merchant_invoice_id, customer_name,
 *             customer_phone, customer_address, delivery_area_id,
 *             delivery_area, cash_collection_amount, parcel_weight,
 *             instruction, value }. The booking note travels as
 *             `instruction`. `parcel_details_json` is deliberately
 *             NOT sent: CreateShipmentInput carries no structured
 *             per-item details (only an item count), so there is
 *             nothing truthful to serialise under a JSON name.
 *   Status:   GET /parcel/track/{tracking_id}.
 *
 * UNVERIFIED-API NOTE (honesty — provenance): RedX publishes NO
 * official public API documentation; its API docs are merchant-gated,
 * so nothing below could be verified against a first-party source.
 * The base URL, endpoint paths, request/response field spellings and
 * the `API-ACCESS-TOKEN` header name rest instead on convergent
 * independent third-party packages (kejubayer, centrex,
 * abdur-rahaman), which agree with each other: the production base
 * https://openapi.redx.com.bd/v1.0.0-beta is their consensus host
 * (sandbox: https://sandbox.redx.com.bd/v1.0.0-beta). The previous
 * default, https://api.redx.com.bd/v1, was supported by NO source
 * found and was replaced on that basis. Everything here remains
 * UNVERIFIED until the first live booking confirms it against the
 * merchant panel — the auth header name is the first thing to
 * re-verify there. Parsing is deliberately TOLERANT (several accepted
 * spellings per field, like the Steadfast webhook parser), and
 * nothing in this module pretends a call succeeded when the provider
 * did not clearly accept it.
 *
 * HONESTY RULES (platform-wide, do not weaken — same as Steadfast):
 *  - A create the provider did not clearly accept THROWS
 *    RedxProviderError. Callers treat a resolved promise as a real
 *    booking, so returning a fabricated shipment would be a phantom
 *    booking — the throw is what gives BullMQ retry / dead-letter.
 *  - CANCEL: no cancel endpoint is exposed by the merchant API as
 *    integrated here, so cancelShipment throws NOT_SUPPORTED (cancel
 *    from the RedX merchant panel). It never marks anything cancelled
 *    locally.
 *  - successRate: no per-phone delivery-history endpoint is known, so
 *    the adapter returns zero counts + successRatePercent null ("no
 *    data") — never simulated numbers.
 *  - getRates: the binding charge for a booking is the charge on the
 *    create response (falling back to one parcel-info read), persisted
 *    on the Shipment row. getRates stays the platform rate-card
 *    ESTIMATE (courierChargePoisha, the same function the sandbox
 *    uses).
 *  - Money: RedX amounts are BDT decimals; they are converted to
 *    integer poisha exactly once, at this boundary. Parcel weight is
 *    sent in kg decimals, converted from grams at the same boundary.
 *  - The access token is a constructor input only — never logged,
 *    never in an error message, never in a URL this module builds.
 *
 * Persistence: bookings persist through the shared shipment store
 * (src/integrations/sandbox/db-store.ts — the DB layer every courier
 * booking uses; the "sandbox" in its path is historical). The store
 * is injected for smoke-testability and the default store loads
 * LAZILY (dynamic import) so this module never pulls Prisma in at
 * import time — the worker-deps landmine rule. Shipment row id =
 * `RX-<parcel_id>` (or the tracking id when the response carries no
 * separate parcel id); trackingId = RedX's tracking id.
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

export class RedxProviderError extends Error {
  readonly provider = "redx" as const;
  /** Machine code: NOT_CONFIGURED | NOT_SUPPORTED | INVALID_INPUT |
   *  INVALID_PHONE | NETWORK | HTTP_<status> | REDX_<code> |
   *  UNRECOGNIZED_RESPONSE. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RedxProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Status mapping — the single source for the live adapter + webhook   */
/* ------------------------------------------------------------------ */

/** Normalise a raw RedX status for map lookup: case/space/hyphen
 *  differences ("in-transit", "In Transit") must not matter. */
export function normalizeRedxStatus(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const REDX_DELIVERY_STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  pickup_pending: "CREATED",
  pickup_requested: "CREATED",
  picked: "PICKED_UP",
  picked_up: "PICKED_UP",
  pickup_completed: "PICKED_UP",
  received_at_hub: "IN_TRANSIT",
  at_hub: "IN_TRANSIT",
  in_transit: "IN_TRANSIT",
  on_hold: "IN_TRANSIT",
  hold: "IN_TRANSIT",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivering: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  delivery_failed: "FAILED",
  failed: "FAILED",
  // ShipmentStatus has no CANCELLED value; a provider-side cancel is a
  // terminal failure of the shipment (same convention as Steadfast).
  cancelled: "FAILED",
  canceled: "FAILED",
  returning: "RETURNING",
  return_in_transit: "RETURNING",
  returned: "RETURNED",
};

/** Map a raw RedX status to the internal ShipmentStatus. Unknown raw
 *  values return null (rejected, never coerced). */
export function mapRedxDeliveryStatus(rawStatus: string): ShipmentStatus | null {
  return REDX_DELIVERY_STATUS_MAP[normalizeRedxStatus(rawStatus)] ?? null;
}

/* ------------------------------------------------------------------ */
/* Money — BDT decimal <-> integer poisha, converted exactly once      */
/* ------------------------------------------------------------------ */

/** BDT decimal (number or numeric string, as RedX returns) -> integer
 *  poisha. Throws on a non-numeric value: a charge we cannot read is
 *  never persisted as a guessed number. */
export function redxBdtToPoisha(value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new RedxProviderError(
      "UNRECOGNIZED_RESPONSE",
      "RedX returned a non-numeric BDT amount.",
    );
  }
  return Math.round(num * 100);
}

/** Integer poisha -> the BDT decimal number RedX expects
 *  (cash_collection_amount). Rounded to 2dp so no float dust reaches
 *  the wire. */
export function poishaToRedxBdt(poisha: number): number {
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

/** RedX `merchant_invoice_id` is the merchant-unique reference: a
 *  retry with the same id must not book a second parcel. Deriving it
 *  deterministically from (orderRef, idempotencyKey) means a BullMQ
 *  retry of the same booking job reuses the same reference — and our
 *  own store replay check returns the original booking before any
 *  network call. */
export function buildRedxMerchantInvoiceId(orderRef: string, idempotencyKey: string): string {
  const base = orderRef.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "ORDER";
  return `${base}-${stableHash36(`${orderRef}:${idempotencyKey}`)}`;
}

/** RedX takes ONE free-text customer address; compose it from the
 *  structured BD address (line first, then union/upazila/district/
 *  division), skipping empty parts. */
export function composeRedxAddress(address: ShipmentAddress): string {
  return [address.addressLine, address.union, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** Normalised BD mobile in RedX's local form (01XXXXXXXXX). Throws
 *  INVALID_PHONE before any network call on a bad number. */
export function redxRecipientPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new RedxProviderError("INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return `0${normalized.slice(4)}`; // "+880" + 10 digits -> "0" + 10 digits
}

/** Grams -> the kg decimal RedX expects (parcel_weight). */
export function gramsToRedxKg(weightGrams: number): number {
  return Number((weightGrams / 1000).toFixed(2));
}

export interface RedxDeliveryArea {
  id: number;
  name: string;
}

export interface RedxCreateParcelBody {
  merchant_invoice_id: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  delivery_area_id: number;
  delivery_area: string;
  /** BDT decimal (the provider's unit — converted from poisha once). */
  cash_collection_amount: number;
  /** kg decimal (the provider's unit — converted from grams once). */
  parcel_weight: number;
  /** The booking note, sent as RedX's delivery `instruction`.
   *  (`parcel_details_json` is omitted entirely: the platform's
   *  CreateShipmentInput has no structured per-item detail fields,
   *  so there is nothing truthful to serialise under that name.) */
  instruction: string;
  value: number;
}

export function buildRedxCreateParcelBody(
  input: CreateShipmentInput,
  merchantInvoiceId: string,
  area: RedxDeliveryArea,
): RedxCreateParcelBody {
  return {
    merchant_invoice_id: merchantInvoiceId,
    customer_name: input.address.recipientName,
    customer_phone: redxRecipientPhone(input.address.recipientPhone),
    customer_address: composeRedxAddress(input.address),
    delivery_area_id: area.id,
    delivery_area: area.name,
    cash_collection_amount: poishaToRedxBdt(input.codAmountPoisha),
    parcel_weight: gramsToRedxKg(input.weightGrams),
    instruction: input.note ?? "",
    // Declared parcel value for the provider's records: the COD
    // amount (0 for a prepaid parcel).
    value: poishaToRedxBdt(input.codAmountPoisha),
  };
}

/** Case/space-insensitive name equality for BD place names. */
function samePlaceName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

/** Resolve the delivery area for a structured address: district match
 *  first (RedX areas are predominantly district/hub level), then
 *  upazila. Null when nothing matches — the caller aborts. */
export function matchRedxArea(
  areas: RedxDeliveryArea[],
  address: ShipmentAddress,
): RedxDeliveryArea | null {
  return (
    areas.find((a) => samePlaceName(a.name, address.district)) ??
    areas.find((a) => samePlaceName(a.name, address.upazila)) ??
    null
  );
}

/* ------------------------------------------------------------------ */
/* Webhook payload normaliser (pure; the route owns verification)      */
/* ------------------------------------------------------------------ */

export interface RedxWebhookEvent {
  trackingId: string;
  rawStatus: string;
  parcelId: string | null;
  merchantInvoiceId: string | null;
  /** COD the payload reports (poisha), converted from a BDT field at
   *  this boundary; the order-sync funnel only applies it on a
   *  DELIVERED event. */
  codCollectedPoisha: number | null;
  /** Deterministic per (parcel, status, updated_at) so a RedX retry of
   *  the same event dedupes against the ShipmentEvent UNIQUE key and
   *  the webhook result cache. */
  idempotencyKey: string;
}

/** Parse a RedX webhook body ({ tracking_id, status, ... }) — sandbox
 *  field spellings (trackingId / rawStatus) are accepted too. Returns
 *  null when the event cannot be identified (no tracking id or no
 *  status): the route rejects it, nothing is applied. */
export function parseRedxWebhookBody(body: unknown): RedxWebhookEvent | null {
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
  const trackingId = str("tracking_id", "trackingId", "tracking_code");
  const rawStatus = str("status", "tracking_status", "delivery_status", "rawStatus");
  if (trackingId === null || rawStatus === null) return null;
  const parcelId = str("parcel_id", "parcelId", "id");
  const updatedAt = str("updated_at", "updatedAt");
  let codCollectedPoisha: number | null = null;
  const poishaField = record.codCollectedPoisha ?? record.codAmountPoisha;
  if (typeof poishaField === "number" && Number.isInteger(poishaField) && poishaField >= 0) {
    codCollectedPoisha = poishaField;
  } else {
    const bdtField = record.collected_amount ?? record.cash_collection_amount ?? record.cod_amount;
    if (bdtField !== undefined && bdtField !== null) {
      try {
        codCollectedPoisha = redxBdtToPoisha(bdtField);
      } catch {
        codCollectedPoisha = null;
      }
    }
  }
  return {
    trackingId,
    rawStatus,
    parcelId,
    merchantInvoiceId: str("merchant_invoice_id", "merchantInvoiceId"),
    codCollectedPoisha,
    idempotencyKey: `redx:${parcelId ?? trackingId}:${normalizeRedxStatus(rawStatus)}:${updatedAt ?? "na"}`,
  };
}

/* ------------------------------------------------------------------ */
/* Shipment persistence (injected; default = the shared DB store)      */
/* ------------------------------------------------------------------ */

export interface RedxShipmentRecord {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
}

export interface RedxShipmentStore {
  /** The shipment a previous booking with this idempotency key made. */
  findByBookingKey(idempotencyKey: string): Promise<RedxShipmentRecord | null>;
  findById(shipmentId: string): Promise<RedxShipmentRecord | null>;
  findByTracking(trackingId: string): Promise<RedxShipmentRecord | null>;
  create(input: {
    shipmentId: string;
    trackingId: string;
    provider: string;
    orderRef: string;
    codAmountPoisha: number;
    weightGrams: number;
    chargePoisha: number;
    idempotencyKey: string;
  }): Promise<RedxShipmentRecord>;
}

async function defaultStore(): Promise<RedxShipmentStore> {
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
    findByTracking: (trackingId) => db.findShipmentByTracking(trackingId, "redx"),
    create: (input) => db.createShipmentRow(input),
  };
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface RedxCredentials {
  accessToken: string;
}

export type RedxFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface RedxAdapterOptions {
  fetchFn?: RedxFetch;
  timeoutMs?: number;
  store?: RedxShipmentStore;
  baseUrl?: string;
}

/** The live RedX provider: the CourierProvider contract plus the
 *  delivery-area lookup the merchant API offers. */
export interface RedxCourierProvider extends CourierProvider {
  listAreas(): Promise<RedxDeliveryArea[]>;
}

/** Default RedX OpenAPI base — the consensus production host across
 *  the independent third-party packages cited in the header note
 *  (sandbox host: https://sandbox.redx.com.bd/v1.0.0-beta). NOT
 *  verified against official docs (none are public); a merchant can
 *  override it without a code change via the courier.redx.base_url
 *  Setting — see redx-resolver.ts. */
export const REDX_API_BASE = "https://openapi.redx.com.bd/v1.0.0-beta";

/** Our Shipment row id for a RedX parcel. */
export function redxShipmentId(parcelId: string | number): string {
  return `RX-${parcelId}`;
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
    provider: "redx",
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credential lives — never the value.
    credentialRef: "settings:courier.redx",
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

function parseAreaList(payload: Record<string, unknown>): RedxDeliveryArea[] {
  let list: unknown = null;
  if (Array.isArray(payload.data)) list = payload.data;
  else if (Array.isArray(payload.areas)) list = payload.areas;
  else if (Array.isArray(payload)) list = payload;
  if (!Array.isArray(list)) return [];
  const out: RedxDeliveryArea[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    let id: number | null = null;
    for (const key of ["id", "area_id"]) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) id = value;
      else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) id = Number(value);
      if (id !== null) break;
    }
    const name = stringField(record, "name", "area_name");
    if (id !== null && name !== null) out.push({ id, name });
  }
  return out;
}

export function createRedxProvider(
  creds: RedxCredentials,
  opts: RedxAdapterOptions = {},
): RedxCourierProvider {
  if (creds.accessToken.trim() === "") {
    throw new RedxProviderError("NOT_CONFIGURED", "RedX access_token is required.");
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (opts.baseUrl ?? REDX_API_BASE).replace(/\/+$/, "");
  const injectedStore = opts.store ?? null;

  let areasCache: RedxDeliveryArea[] | null = null;

  async function store(): Promise<RedxShipmentStore> {
    return injectedStore ?? defaultStore();
  }

  async function callApi(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          // RedX merchant API access-token header (see the UNVERIFIED
          // note in the file header — re-verify at first live use).
          "API-ACCESS-TOKEN": creds.accessToken,
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // No URL/headers in the message: nothing here may carry a secret.
      throw new RedxProviderError("NETWORK", "RedX request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      throw new RedxProviderError(`HTTP_${res.status}`, `RedX returned HTTP ${res.status}.`);
    }
    const json = asRecord(parseJsonLoose(text));
    if (json === null) {
      throw new RedxProviderError("UNRECOGNIZED_RESPONSE", "RedX returned a non-JSON response.");
    }
    return json;
  }

  async function listAreas(): Promise<RedxDeliveryArea[]> {
    if (areasCache !== null) return areasCache;
    const json = await callApi("/areas", { method: "GET" });
    areasCache = parseAreaList(json);
    return areasCache;
  }

  /** The charge RedX recorded for a parcel (BDT field -> poisha);
   *  null when neither the create response nor parcel info carries
   *  one. One parcel-info read is the fallback, mirroring how the
   *  Steadfast adapter refuses to persist an unreadable charge. */
  function chargeFromRecord(record: Record<string, unknown>): number | null {
    const field =
      record.delivery_charge ?? record.charge ?? record.delivery_fee ?? record.deliveryCharge;
    if (field === undefined || field === null) return null;
    try {
      return redxBdtToPoisha(field);
    } catch {
      return null;
    }
  }

  return {
    name: "redx",
    config: liveConfig(),

    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        throw new RedxProviderError("INVALID_INPUT", "Invalid shipment input.");
      }
      if (input.provider !== "redx") {
        throw new RedxProviderError(
          "INVALID_INPUT",
          `RedX adapter cannot book provider "${input.provider}".`,
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
      const area = matchRedxArea(await listAreas(), input.address);
      if (area === null) {
        throw new RedxProviderError(
          "INVALID_INPUT",
          `RedX has no delivery area matching district "${input.address.district}" or upazila "${input.address.upazila}".`,
        );
      }
      const merchantInvoiceId = buildRedxMerchantInvoiceId(
        parsed.data.orderId,
        parsed.data.idempotencyKey,
      );
      const body = buildRedxCreateParcelBody(input, merchantInvoiceId, area);
      const json = await callApi("/parcel", { method: "POST", body: JSON.stringify(body) });
      const data = asRecord(json.data) ?? json;
      const trackingId = stringField(data, "tracking_id", "trackingId", "tracking_code");
      const parcelId = stringField(data, "parcel_id", "parcelId", "id") ?? trackingId;
      if (trackingId === null || parcelId === null) {
        throw new RedxProviderError(
          "UNRECOGNIZED_RESPONSE",
          "RedX create-parcel response had no tracking id.",
        );
      }
      // The ACTUAL charge for this parcel (BDT decimal at the
      // boundary -> poisha). When the create response carries none,
      // one parcel-info read is tried; a charge we still cannot read
      // is never persisted as a guess — the booking exists
      // provider-side under `merchantInvoiceId`, so a retry replays
      // safely instead of double-booking.
      let chargePoisha = chargeFromRecord(data);
      if (chargePoisha === null) {
        try {
          const info = await callApi(`/parcel/info/${encodeURIComponent(parcelId)}`, {
            method: "GET",
          });
          const infoData = asRecord(info.data) ?? info;
          chargePoisha = chargeFromRecord(infoData);
        } catch {
          chargePoisha = null;
        }
      }
      if (chargePoisha === null) {
        throw new RedxProviderError(
          "UNRECOGNIZED_RESPONSE",
          "RedX create-parcel response had no readable delivery charge.",
        );
      }
      const shipmentId = redxShipmentId(parcelId);
      try {
        const shipment = await shipments.create({
          shipmentId,
          trackingId,
          provider: "redx",
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
            (await shipments.findById(shipmentId)) ?? (await shipments.findByTracking(trackingId));
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
      // No cancel endpoint is exposed by the merchant API as
      // integrated here. Faking a local cancel would leave a live
      // parcel on the road marked cancelled here — the exact failure
      // the honesty rules exist to prevent.
      throw new RedxProviderError(
        "NOT_SUPPORTED",
        "RedX merchant API has no cancel endpoint in this integration; cancel the parcel from the RedX merchant panel.",
      );
    },

    async getStatus(trackingId: string) {
      // Accepts a tracking id, or our `RX-<parcel_id>` shipment id
      // (the track endpoint is keyed by the tracking id, which the
      // create response also returns as the parcel identifier when
      // no separate tracking id exists).
      const id = trackingId.startsWith("RX-") ? trackingId.slice(3) : trackingId;
      const json = await callApi(`/parcel/track/${encodeURIComponent(id)}`, { method: "GET" });
      const data = asRecord(json.data) ?? json;
      const raw = stringField(data, "status", "tracking_status", "delivery_status", "parcel_status");
      if (raw === null) {
        throw new RedxProviderError(
          "UNRECOGNIZED_RESPONSE",
          "RedX track response had no status field.",
        );
      }
      const status = mapRedxDeliveryStatus(raw);
      if (status === null) {
        throw new RedxProviderError(
          "UNRECOGNIZED_RESPONSE",
          `RedX returned an unknown status "${raw}".`,
        );
      }
      // Events: the track API returns only the CURRENT status, so the
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
      // Platform rate-card ESTIMATE (see header): the binding charge
      // arrives with the create response and is what the row persists.
      return [
        {
          provider: "redx",
          chargePoisha: courierChargePoisha(input.zone, input.weightGrams),
          estimatedDays: 3,
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

    listAreas,
  };
}
