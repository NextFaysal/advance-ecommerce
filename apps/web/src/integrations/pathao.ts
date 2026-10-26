/**
 * Pathao Courier LIVE adapter — ADV-5 remainder (doc 22).
 *
 * Implements the CourierProvider interface (src/integrations/courier.ts)
 * against the Pathao merchant API, mirroring the Steadfast live adapter
 * (src/integrations/steadfast.ts) contract-for-contract:
 *
 *   Base:     https://merchant.pathao.com/aladdin/api/v1
 *   Auth:     OAuth2 — POST /issue-token (grant_type "password" with
 *             client_id + client_secret + merchant username + password)
 *             -> { access_token, refresh_token, expires_in }; the token
 *             is cached per adapter instance and refreshed via the
 *             refresh_token grant (falling back to a fresh password
 *             grant) once it nears expiry. Credentials come from
 *             encrypted Settings — see pathao-resolver.ts (Settings keys
 *             courier.pathao.client_id / .client_secret / .username /
 *             .password / .store_id).
 *   Create:   POST /orders — Pathao addresses parcels by numeric
 *             city/zone/area IDS, not names, so booking first resolves
 *             the structured BD address through the lookup endpoints
 *             (GET /countries/1/city-list, GET /cities/{id}/zone-list,
 *             GET /zones/{id}/area-list; lists are cached per instance).
 *             An address part that matches NO Pathao entry aborts the
 *             booking with INVALID_INPUT — an id is never guessed.
 *   Status:   GET /orders/{consignment_id} -> data.order_status.
 *   Fees:     POST /merchant/price-plan (estimatePricePlan below).
 *
 * UNVERIFIED-API NOTE (honesty): this adapter was built from the
 * codebase's own sandbox vocabulary + the Pathao merchant API shape as
 * documented publicly; no live Pathao account exists on this install
 * yet, so field spellings are parsed TOLERANTLY (several accepted
 * spellings per field, like the Steadfast webhook parser) and the
 * first live booking must be checked against the merchant panel. The
 * delivery_type (12 = normal) and item_type (2 = parcel) constants
 * are the documented values as understood at build time.
 *
 * HONESTY RULES (platform-wide, do not weaken — same as Steadfast):
 *  - A create the provider did not clearly accept THROWS
 *    PathaoProviderError. Callers treat a resolved promise as a real
 *    booking, so returning a fabricated shipment would be a phantom
 *    booking — the throw is what gives BullMQ retry / dead-letter.
 *  - CANCEL: no cancel endpoint is exposed by the merchant API v1 as
 *    integrated here, so cancelShipment throws NOT_SUPPORTED (cancel
 *    from the Pathao merchant panel). It never marks anything
 *    cancelled locally.
 *  - successRate: no per-phone delivery-history endpoint is known, so
 *    the adapter returns zero counts + successRatePercent null ("no
 *    data") — never simulated numbers.
 *  - getRates: the binding charge for a booking is the delivery_fee
 *    on the create response, persisted on the Shipment row. getRates
 *    stays the platform rate-card ESTIMATE (courierChargePoisha, the
 *    same function the sandbox uses); estimatePricePlan() is the
 *    provider's own fee lookup for callers that hold Pathao ids.
 *  - Money: Pathao amounts are BDT decimals; they are converted to
 *    integer poisha exactly once, at this boundary.
 *  - Credentials and OAuth tokens are constructor inputs / closure
 *    state only — never logged, never in an error message, never in
 *    a URL this module builds.
 *
 * Persistence: bookings persist through the shared shipment store
 * (src/integrations/sandbox/db-store.ts — the DB layer every courier
 * booking uses; the "sandbox" in its path is historical). The store
 * is injected for smoke-testability and the default store loads
 * LAZILY (dynamic import) so this module never pulls Prisma in at
 * import time — the worker-deps landmine rule. Shipment row id =
 * `PT-<consignment_id>`; trackingId = the consignment id itself
 * (Pathao has no separate tracking code — customers track by
 * consignment id).
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

export class PathaoProviderError extends Error {
  readonly provider = "pathao" as const;
  /** Machine code: NOT_CONFIGURED | NOT_SUPPORTED | INVALID_INPUT |
   *  INVALID_PHONE | NETWORK | HTTP_<status> | PATHAO_<code> |
   *  UNRECOGNIZED_RESPONSE. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PathaoProviderError";
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Status mapping — the single source for the live adapter + webhook   */
/* ------------------------------------------------------------------ */

/** Normalise a raw Pathao status for map lookup: case/space/hyphen
 *  differences ("In Transit", "in-transit") must not matter. */
export function normalizePathaoStatus(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export const PATHAO_DELIVERY_STATUS_MAP: Record<string, ShipmentStatus> = {
  pending: "CREATED",
  order_placed: "CREATED",
  pickup_requested: "CREATED",
  // "assigned" = a rider is assigned; the sandbox map already treats
  // assignment as the pickup step, so the live map stays consistent.
  assigned: "PICKED_UP",
  picked: "PICKED_UP",
  picked_up: "PICKED_UP",
  pickup_completed: "PICKED_UP",
  at_sorting_hub: "IN_TRANSIT",
  received_at_hub: "IN_TRANSIT",
  in_transit: "IN_TRANSIT",
  // A hold is a pause, not a failure (the Steadfast live convention;
  // the sandbox's pathao on_hold -> FAILED stays sandbox-only).
  on_hold: "IN_TRANSIT",
  hold: "IN_TRANSIT",
  delivering: "OUT_FOR_DELIVERY",
  out_for_delivery: "OUT_FOR_DELIVERY",
  delivered: "DELIVERED",
  partial_delivered: "DELIVERED",
  partial_delivery: "DELIVERED",
  delivery_failed: "FAILED",
  failed: "FAILED",
  // ShipmentStatus has no CANCELLED value; a provider-side cancel is a
  // terminal failure of the shipment (same convention as Steadfast).
  cancelled: "FAILED",
  canceled: "FAILED",
  return_in_transit: "RETURNING",
  returning: "RETURNING",
  returned: "RETURNED",
  return: "RETURNED",
};

/** Map a raw Pathao order_status to the internal ShipmentStatus.
 *  Unknown raw values return null (rejected, never coerced). */
export function mapPathaoDeliveryStatus(rawStatus: string): ShipmentStatus | null {
  return PATHAO_DELIVERY_STATUS_MAP[normalizePathaoStatus(rawStatus)] ?? null;
}

/* ------------------------------------------------------------------ */
/* Money — BDT decimal <-> integer poisha, converted exactly once      */
/* ------------------------------------------------------------------ */

/** BDT decimal (number or numeric string, as Pathao returns) ->
 *  integer poisha. Throws on a non-numeric value: a charge we cannot
 *  read is never persisted as a guessed number. */
export function pathaoBdtToPoisha(value: unknown): number {
  const num =
    typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;
  if (!Number.isFinite(num)) {
    throw new PathaoProviderError(
      "UNRECOGNIZED_RESPONSE",
      "Pathao returned a non-numeric BDT amount.",
    );
  }
  return Math.round(num * 100);
}

/** Integer poisha -> the BDT decimal number Pathao expects
 *  (amount_to_collect). Rounded to 2dp so no float dust reaches the wire. */
export function poishaToPathaoBdt(poisha: number): number {
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

/** Pathao `merchant_order_id` is the merchant-unique reference: a
 *  retry with the same id must not book a second parcel. Deriving it
 *  deterministically from (orderRef, idempotencyKey) means a BullMQ
 *  retry of the same booking job reuses the same reference — and our
 *  own store replay check returns the original booking before any
 *  network call. */
export function buildPathaoMerchantOrderId(orderRef: string, idempotencyKey: string): string {
  const base = orderRef.replace(/[^A-Za-z0-9-]/g, "").slice(0, 24) || "ORDER";
  return `${base}-${stableHash36(`${orderRef}:${idempotencyKey}`)}`;
}

/** Pathao takes ONE free-text recipient address; compose it from the
 *  structured BD address (line first, then union/upazila/district/
 *  division), skipping empty parts. */
export function composePathaoAddress(address: ShipmentAddress): string {
  return [address.addressLine, address.union, address.upazila, address.district, address.division]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ");
}

/** Normalised BD mobile in Pathao's local form (01XXXXXXXXX).
 *  Throws INVALID_PHONE before any network call on a bad number. */
export function pathaoRecipientPhone(raw: string): string {
  const normalized = normalizeBdPhone(raw);
  if (normalized === null) {
    throw new PathaoProviderError("INVALID_PHONE", "Recipient is not a valid BD mobile number.");
  }
  return `0${normalized.slice(4)}`; // "+880" + 10 digits -> "0" + 10 digits
}

/** Grams -> the kg decimal Pathao expects (item_weight). */
export function gramsToPathaoKg(weightGrams: number): number {
  return Number((weightGrams / 1000).toFixed(2));
}

export interface PathaoCreateOrderBody {
  store_id: number;
  merchant_order_id: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  recipient_city: number;
  recipient_zone: number;
  /** Null when the union matched no Pathao area (area is the most
   *  granular level; city + zone are the required ones). */
  recipient_area: number | null;
  /** 12 = normal delivery (documented value; see header note). */
  delivery_type: 12;
  /** 2 = parcel (documented value; see header note). */
  item_type: 2;
  special_instruction: string;
  item_quantity: number;
  /** kg decimal (the provider's unit — converted from grams once). */
  item_weight: number;
  /** BDT decimal (the provider's unit — converted from poisha once). */
  amount_to_collect: number;
}

export interface PathaoResolvedAddressIds {
  cityId: number;
  zoneId: number;
  areaId: number | null;
}

export function buildPathaoCreateOrderBody(
  input: CreateShipmentInput,
  merchantOrderId: string,
  storeId: number,
  ids: PathaoResolvedAddressIds,
): PathaoCreateOrderBody {
  return {
    store_id: storeId,
    merchant_order_id: merchantOrderId,
    recipient_name: input.address.recipientName,
    recipient_phone: pathaoRecipientPhone(input.address.recipientPhone),
    recipient_address: composePathaoAddress(input.address),
    recipient_city: ids.cityId,
    recipient_zone: ids.zoneId,
    recipient_area: ids.areaId,
    delivery_type: 12,
    item_type: 2,
    special_instruction: input.note ?? "",
    item_quantity: input.itemCount,
    item_weight: gramsToPathaoKg(input.weightGrams),
    amount_to_collect: poishaToPathaoBdt(input.codAmountPoisha),
  };
}

/* ------------------------------------------------------------------ */
/* Webhook payload normaliser (pure; the route owns verification)      */
/* ------------------------------------------------------------------ */

export interface PathaoWebhookEvent {
  trackingId: string;
  rawStatus: string;
  consignmentId: string | null;
  merchantOrderId: string | null;
  /** COD the payload reports (poisha), converted from a BDT field at
   *  this boundary; the order-sync funnel only applies it on a
   *  DELIVERED event. */
  codCollectedPoisha: number | null;
  /** Deterministic per (consignment, status, updated_at) so a Pathao
   *  retry of the same event dedupes against the ShipmentEvent UNIQUE
   *  key and the webhook result cache. */
  idempotencyKey: string;
}

/** Parse a Pathao webhook body ({ consignment_id, merchant_order_id,
 *  order_status, ... }) — sandbox field spellings (trackingId /
 *  rawStatus / delivery_status) are accepted too. Returns null when
 *  the event cannot be identified (no consignment id or no status):
 *  the route rejects it, nothing is applied. */
export function parsePathaoWebhookBody(body: unknown): PathaoWebhookEvent | null {
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
  const consignmentId = str("consignment_id", "consignmentId");
  const trackingId = consignmentId ?? str("trackingId", "tracking_id");
  const rawStatus = str("order_status", "status", "delivery_status", "rawStatus");
  if (trackingId === null || rawStatus === null) return null;
  const updatedAt = str("updated_at", "updatedAt");
  let codCollectedPoisha: number | null = null;
  const poishaField = record.codCollectedPoisha ?? record.codAmountPoisha;
  if (typeof poishaField === "number" && Number.isInteger(poishaField) && poishaField >= 0) {
    codCollectedPoisha = poishaField;
  } else {
    const bdtField = record.collected_amount ?? record.amount_to_collect ?? record.cod_amount;
    if (bdtField !== undefined && bdtField !== null) {
      try {
        codCollectedPoisha = pathaoBdtToPoisha(bdtField);
      } catch {
        codCollectedPoisha = null;
      }
    }
  }
  return {
    trackingId,
    rawStatus,
    consignmentId,
    merchantOrderId: str("merchant_order_id", "merchantOrderId"),
    codCollectedPoisha,
    idempotencyKey: `pathao:${consignmentId ?? trackingId}:${normalizePathaoStatus(rawStatus)}:${updatedAt ?? "na"}`,
  };
}

/* ------------------------------------------------------------------ */
/* Shipment persistence (injected; default = the shared DB store)      */
/* ------------------------------------------------------------------ */

export interface PathaoShipmentRecord {
  shipmentId: string;
  trackingId: string;
  status: ShipmentStatus;
  statusHistory: ShipmentStatus[];
}

export interface PathaoShipmentStore {
  /** The shipment a previous booking with this idempotency key made. */
  findByBookingKey(idempotencyKey: string): Promise<PathaoShipmentRecord | null>;
  findById(shipmentId: string): Promise<PathaoShipmentRecord | null>;
  findByTracking(trackingId: string): Promise<PathaoShipmentRecord | null>;
  create(input: {
    shipmentId: string;
    trackingId: string;
    provider: string;
    orderRef: string;
    codAmountPoisha: number;
    weightGrams: number;
    chargePoisha: number;
    idempotencyKey: string;
  }): Promise<PathaoShipmentRecord>;
}

async function defaultStore(): Promise<PathaoShipmentStore> {
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
    findByTracking: (trackingId) => db.findShipmentByTracking(trackingId, "pathao"),
    create: (input) => db.createShipmentRow(input),
  };
}

/* ------------------------------------------------------------------ */
/* Lookup shapes (cities / zones / areas / stores)                     */
/* ------------------------------------------------------------------ */

export interface PathaoNamedId {
  id: number;
  name: string;
}

function parseNamedIdList(payload: unknown, idKeys: string[], nameKeys: string[]): PathaoNamedId[] {
  // Pathao wraps lists as { data: [...] }; some endpoints nest one
  // more level ({ data: { cities: [...] } }). Accept all three.
  let list: unknown = null;
  if (Array.isArray(payload)) list = payload;
  else if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.data)) list = record.data;
    else if (typeof record.data === "object" && record.data !== null) {
      const inner = record.data as Record<string, unknown>;
      for (const key of Object.keys(inner)) {
        if (Array.isArray(inner[key])) {
          list = inner[key];
          break;
        }
      }
    }
  }
  if (!Array.isArray(list)) return [];
  const out: PathaoNamedId[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    let id: number | null = null;
    for (const key of idKeys) {
      const value = record[key];
      if (typeof value === "number" && Number.isFinite(value)) id = value;
      else if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) id = Number(value);
      if (id !== null) break;
    }
    let name: string | null = null;
    for (const key of nameKeys) {
      const value = record[key];
      if (typeof value === "string" && value.trim() !== "") {
        name = value.trim();
        break;
      }
    }
    if (id !== null && name !== null) out.push({ id, name });
  }
  return out;
}

/** Case/space-insensitive name equality for BD place names. */
function samePlaceName(a: string, b: string): boolean {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(a) === norm(b);
}

function matchNamedId(list: PathaoNamedId[], wanted: string): PathaoNamedId | null {
  return list.find((entry) => samePlaceName(entry.name, wanted)) ?? null;
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

export interface PathaoCredentials {
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  /** The merchant store every booking is created under (Pathao
   *  requires store_id on create; one default store per install). */
  storeId: number;
}

export type PathaoFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface PathaoAdapterOptions {
  fetchFn?: PathaoFetch;
  timeoutMs?: number;
  store?: PathaoShipmentStore;
  baseUrl?: string;
}

export interface PathaoPricePlan {
  /** Provider-quoted delivery fee, integer poisha. */
  feePoisha: number;
  /** Provider-quoted COD fee, integer poisha (0 when absent). */
  codFeePoisha: number;
  /** fee + cod fee, integer poisha (0 when the provider gave no total). */
  totalPoisha: number;
}

/** The live Pathao provider: the CourierProvider contract plus the
 *  lookup + fee endpoints the merchant API offers. */
export interface PathaoCourierProvider extends CourierProvider {
  listCities(): Promise<PathaoNamedId[]>;
  listZones(cityId: number): Promise<PathaoNamedId[]>;
  listAreas(zoneId: number): Promise<PathaoNamedId[]>;
  listStores(): Promise<PathaoNamedId[]>;
  estimatePricePlan(input: {
    cityId: number;
    zoneId: number;
    weightGrams: number;
  }): Promise<PathaoPricePlan>;
}

export const PATHAO_API_BASE = "https://merchant.pathao.com/aladdin/api/v1";

/** Our Shipment row id for a Pathao consignment. */
export function pathaoShipmentId(consignmentId: string | number): string {
  return `PT-${consignmentId}`;
}

const DEFAULT_TIMEOUT_MS = 20_000;
/** Refresh the OAuth token this long before its stated expiry. */
const TOKEN_EXPIRY_SKEW_MS = 30_000;

const createSchema = z.object({
  orderId: z.string().min(1),
  codAmountPoisha: z.number().int().nonnegative(),
  weightGrams: z.number().int().positive(),
  itemCount: z.number().int().positive(),
  idempotencyKey: z.string().min(1),
});

function liveConfig(): ProviderConfig {
  return {
    provider: "pathao",
    enabled: true,
    mode: "live",
    status: "configured",
    // A reference to where the credential lives — never the value.
    credentialRef: "settings:courier.pathao",
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

interface CachedToken {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms at which the token stops being trusted (expiry - skew). */
  usableUntilMs: number;
}

export function createPathaoProvider(
  creds: PathaoCredentials,
  opts: PathaoAdapterOptions = {},
): PathaoCourierProvider {
  if (
    creds.clientId.trim() === "" ||
    creds.clientSecret.trim() === "" ||
    creds.username.trim() === "" ||
    creds.password.trim() === "" ||
    !Number.isInteger(creds.storeId) ||
    creds.storeId <= 0
  ) {
    throw new PathaoProviderError(
      "NOT_CONFIGURED",
      "Pathao client_id, client_secret, username, password and a positive store_id are all required.",
    );
  }
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (opts.baseUrl ?? PATHAO_API_BASE).replace(/\/+$/, "");
  const injectedStore = opts.store ?? null;

  let cachedToken: CachedToken | null = null;
  let citiesCache: PathaoNamedId[] | null = null;
  const zonesCache = new Map<number, PathaoNamedId[]>();
  const areasCache = new Map<number, PathaoNamedId[]>();

  async function store(): Promise<PathaoShipmentStore> {
    return injectedStore ?? defaultStore();
  }

  async function rawCall(
    path: string,
    init: RequestInit,
    accessToken: string | null,
  ): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(accessToken !== null ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(init.headers ?? {}),
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // No URL/headers in the message: nothing here may carry a secret.
      throw new PathaoProviderError("NETWORK", "Pathao request failed (network error or timeout).");
    }
    const text = await res.text().catch(() => "");
    if (res.status < 200 || res.status >= 300) {
      throw new PathaoProviderError(`HTTP_${res.status}`, `Pathao returned HTTP ${res.status}.`);
    }
    const json = asRecord(parseJsonLoose(text));
    if (json === null) {
      throw new PathaoProviderError("UNRECOGNIZED_RESPONSE", "Pathao returned a non-JSON response.");
    }
    // Pathao mirrors its outcome in a body `code` field (200 = ok);
    // validation failures come back with e.g. code 422 + message.
    const bodyCode = typeof json.code === "number" ? json.code : null;
    if (bodyCode !== null && bodyCode !== 200) {
      const message = stringField(json, "message") ?? "provider rejected the request";
      throw new PathaoProviderError(`PATHAO_${bodyCode}`, `Pathao error ${bodyCode}: ${message}`);
    }
    return json;
  }

  async function requestToken(grant: Record<string, string>): Promise<CachedToken> {
    const json = await rawCall("/issue-token", { method: "POST", body: JSON.stringify(grant) }, null);
    const accessToken = stringField(json, "access_token");
    if (accessToken === null) {
      throw new PathaoProviderError(
        "UNRECOGNIZED_RESPONSE",
        "Pathao issue-token response had no access_token.",
      );
    }
    const expiresInSec =
      typeof json.expires_in === "number" && Number.isFinite(json.expires_in) ? json.expires_in : 3600;
    return {
      accessToken,
      refreshToken: stringField(json, "refresh_token"),
      usableUntilMs: Date.now() + expiresInSec * 1000 - TOKEN_EXPIRY_SKEW_MS,
    };
  }

  async function getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && cachedToken !== null && Date.now() < cachedToken.usableUntilMs) {
      return cachedToken.accessToken;
    }
    // Prefer the refresh grant when a refresh token is held; any
    // failure falls back to a fresh password grant (a stale refresh
    // token must not wedge every booking behind it).
    if (cachedToken?.refreshToken) {
      try {
        cachedToken = await requestToken({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: cachedToken.refreshToken,
          grant_type: "refresh_token",
        });
        return cachedToken.accessToken;
      } catch {
        cachedToken = null;
      }
    }
    cachedToken = await requestToken({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      username: creds.username,
      password: creds.password,
      grant_type: "password",
    });
    return cachedToken.accessToken;
  }

  async function callApi(path: string, init: RequestInit): Promise<Record<string, unknown>> {
    const token = await getAccessToken();
    try {
      return await rawCall(path, init, token);
    } catch (err) {
      // A 401 on a cached token usually means the provider revoked /
      // expired it early: refresh ONCE and retry, then surface.
      if (err instanceof PathaoProviderError && err.code === "HTTP_401") {
        const fresh = await getAccessToken(true);
        return rawCall(path, init, fresh);
      }
      throw err;
    }
  }

  async function listCities(): Promise<PathaoNamedId[]> {
    if (citiesCache !== null) return citiesCache;
    const json = await callApi("/countries/1/city-list", { method: "GET" });
    citiesCache = parseNamedIdList(json, ["city_id", "id"], ["city_name", "name"]);
    return citiesCache;
  }

  async function listZones(cityId: number): Promise<PathaoNamedId[]> {
    const cached = zonesCache.get(cityId);
    if (cached) return cached;
    const json = await callApi(`/cities/${cityId}/zone-list`, { method: "GET" });
    const zones = parseNamedIdList(json, ["zone_id", "id"], ["zone_name", "name"]);
    zonesCache.set(cityId, zones);
    return zones;
  }

  async function listAreas(zoneId: number): Promise<PathaoNamedId[]> {
    const cached = areasCache.get(zoneId);
    if (cached) return cached;
    const json = await callApi(`/zones/${zoneId}/area-list`, { method: "GET" });
    const areas = parseNamedIdList(json, ["area_id", "id"], ["area_name", "name"]);
    areasCache.set(zoneId, areas);
    return areas;
  }

  /** Resolve the structured BD address to Pathao ids. District ->
   *  city and upazila -> zone are REQUIRED (create refuses id-less
   *  addresses); union -> area is best-effort (null when unmatched). */
  async function resolveAddressIds(address: ShipmentAddress): Promise<PathaoResolvedAddressIds> {
    const city = matchNamedId(await listCities(), address.district);
    if (city === null) {
      throw new PathaoProviderError(
        "INVALID_INPUT",
        `Pathao has no city matching district "${address.district}".`,
      );
    }
    const zone = matchNamedId(await listZones(city.id), address.upazila);
    if (zone === null) {
      throw new PathaoProviderError(
        "INVALID_INPUT",
        `Pathao has no zone matching upazila "${address.upazila}" in city "${address.district}".`,
      );
    }
    let areaId: number | null = null;
    if (address.union !== null && address.union.trim() !== "") {
      const area = matchNamedId(await listAreas(zone.id), address.union);
      areaId = area?.id ?? null;
    }
    return { cityId: city.id, zoneId: zone.id, areaId };
  }

  return {
    name: "pathao",
    config: liveConfig(),

    async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
      const parsed = createSchema.safeParse(input);
      if (!parsed.success) {
        throw new PathaoProviderError("INVALID_INPUT", "Invalid shipment input.");
      }
      if (input.provider !== "pathao") {
        throw new PathaoProviderError(
          "INVALID_INPUT",
          `Pathao adapter cannot book provider "${input.provider}".`,
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
      const ids = await resolveAddressIds(input.address);
      const merchantOrderId = buildPathaoMerchantOrderId(parsed.data.orderId, parsed.data.idempotencyKey);
      const body = buildPathaoCreateOrderBody(input, merchantOrderId, creds.storeId, ids);
      const json = await callApi("/orders", { method: "POST", body: JSON.stringify(body) });
      const data = asRecord(json.data) ?? json;
      const consignmentId = stringField(data, "consignment_id", "consignmentId");
      if (consignmentId === null) {
        throw new PathaoProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Pathao create-order response had no consignment id.",
        );
      }
      // The ACTUAL charge for this consignment (BDT decimal at the
      // boundary -> poisha). Missing fee = a response shape we do not
      // trust enough to persist; the booking exists provider-side
      // under `merchantOrderId`, so a retry replays safely.
      const feeField = data.delivery_fee ?? data.deliveryFee;
      if (feeField === undefined || feeField === null) {
        throw new PathaoProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Pathao create-order response had no delivery_fee.",
        );
      }
      const chargePoisha = pathaoBdtToPoisha(feeField);
      const shipmentId = pathaoShipmentId(consignmentId);
      try {
        const shipment = await shipments.create({
          shipmentId,
          trackingId: consignmentId,
          provider: "pathao",
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
            (await shipments.findById(shipmentId)) ?? (await shipments.findByTracking(consignmentId));
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
      throw new PathaoProviderError(
        "NOT_SUPPORTED",
        "Pathao merchant API has no cancel endpoint in this integration; cancel the consignment from the Pathao merchant panel.",
      );
    },

    async getStatus(trackingId: string) {
      // Accepts a consignment id, or our `PT-<consignment_id>` id.
      const consignmentId = trackingId.startsWith("PT-") ? trackingId.slice(3) : trackingId;
      const json = await callApi(`/orders/${encodeURIComponent(consignmentId)}`, { method: "GET" });
      const data = asRecord(json.data) ?? json;
      const raw = stringField(data, "order_status", "status", "delivery_status");
      if (raw === null) {
        throw new PathaoProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Pathao order response had no order_status.",
        );
      }
      const status = mapPathaoDeliveryStatus(raw);
      if (status === null) {
        throw new PathaoProviderError(
          "UNRECOGNIZED_RESPONSE",
          `Pathao returned an unknown order_status "${raw}".`,
        );
      }
      // Events: the API returns only the CURRENT status, so the
      // history is our own Shipment row's (empty when the parcel was
      // booked outside this install — reported honestly, not invented).
      let events: string[] = [];
      try {
        const shipments = await store();
        const row = await shipments.findByTracking(consignmentId);
        if (row !== null) events = [...row.statusHistory];
      } catch {
        events = [];
      }
      return { status, events };
    },

    async getRates(input: CourierRateInput): Promise<CourierRate[]> {
      // Platform rate-card ESTIMATE (see header): the binding charge
      // arrives with the create response; estimatePricePlan() is the
      // provider's own fee lookup for callers holding Pathao ids.
      return [
        {
          provider: "pathao",
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

    listCities,
    listZones,
    listAreas,

    async listStores(): Promise<PathaoNamedId[]> {
      const json = await callApi("/stores", { method: "GET" });
      return parseNamedIdList(json, ["store_id", "id"], ["store_name", "name"]);
    },

    async estimatePricePlan(input: {
      cityId: number;
      zoneId: number;
      weightGrams: number;
    }): Promise<PathaoPricePlan> {
      const json = await callApi("/merchant/price-plan", {
        method: "POST",
        body: JSON.stringify({
          store_id: creds.storeId,
          item_type: 2,
          delivery_type: 12,
          item_weight: gramsToPathaoKg(input.weightGrams),
          recipient_city: input.cityId,
          recipient_zone: input.zoneId,
        }),
      });
      const data = asRecord(json.data) ?? json;
      const feeField = data.price ?? data.delivery_fee;
      if (feeField === undefined || feeField === null) {
        throw new PathaoProviderError(
          "UNRECOGNIZED_RESPONSE",
          "Pathao price-plan response had no fee field.",
        );
      }
      const feePoisha = pathaoBdtToPoisha(feeField);
      const codFeePoisha =
        data.cod_fee === undefined || data.cod_fee === null ? 0 : pathaoBdtToPoisha(data.cod_fee);
      const totalPoisha =
        data.total_fee === undefined || data.total_fee === null
          ? feePoisha + codFeePoisha
          : pathaoBdtToPoisha(data.total_fee);
      return { feePoisha, codFeePoisha, totalPoisha };
    },
  };
}
